package dev.jvmvisualizer.compileservice.compiler;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.ProcessBuilder.Redirect;
import java.net.URL;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

public class ForkedCompiler implements SourceCompiler, AutoCloseable {

    public static final String UNAVAILABLE_MESSAGE = "the compiler could not be run; retry in a moment";
    public static final String BUSY_MESSAGE = "the compile service is at capacity, retry in a moment";
    public static final Duration RETRY_AFTER = Duration.ofSeconds(5);

    static final String TIMEOUT_MESSAGE = "compilation timed out";

    private static final Logger log = LoggerFactory.getLogger(ForkedCompiler.class);

    private static final List<String> CHILD_VM_OPTIONS = List.of(
            "-Xmx128m",
            "-XX:MaxMetaspaceSize=64m",
            "-XX:ReservedCodeCacheSize=32m",
            "-XX:MaxDirectMemorySize=16m",
            "-Xss1m",
            "-XX:+UseSerialGC",
            "-XX:TieredStopAtLevel=1",
            "-XX:-UsePerfData");

    private static final Duration REAPING_GRACE = Duration.ofSeconds(5);

    private static final int MAX_RESULT_BYTES = 4 * 1024 * 1024;

    private final Duration timeout;
    private final List<String> command;
    private final ThreadPoolExecutor pool;
    private final ScheduledExecutorService watchdog;
    private final Set<Process> running = ConcurrentHashMap.newKeySet();
    private final ObjectMapper objectMapper = JsonMapper.builder().build();
    private volatile boolean closed;

    public ForkedCompiler(Duration timeout, int maxConcurrentCompilations) {
        this(timeout, maxConcurrentCompilations, List.of());
    }

    ForkedCompiler(Duration timeout, int maxConcurrentCompilations, List<String> extraChildVmOptions) {
        this.timeout = Objects.requireNonNull(timeout, "timeout");
        this.command = command(extraChildVmOptions);
        this.pool = boundedPool(maxConcurrentCompilations);
        this.watchdog = Executors.newSingleThreadScheduledExecutor(daemonThreads("compile-watchdog"));
        log.info("compiling in child processes: at most {} at a time, {} each, command {}",
                maxConcurrentCompilations, timeout, command);
        warnIfTheChildCannotBeLaunched();
    }

    static List<String> childVmOptions() {
        return CHILD_VM_OPTIONS;
    }

    private static void warnIfTheChildCannotBeLaunched() {
        URL location = CompilerProcessMain.class.getResource("CompilerProcessMain.class");
        if (location != null && location.toString().contains("!/BOOT-INF/")) {
            log.error("running from a repackaged jar: the compiler process cannot load {} from "
                            + "java.class.path and every compilation will fail; run the application "
                            + "exploded, as the Dockerfile does",
                    CompilerProcessMain.class.getName());
        }
    }

    @Override
    public CompilationResult compile(SourceUnit unit) {
        Future<CompilationResult> pending;
        try {
            pending = pool.submit(() -> run(unit));
        } catch (RejectedExecutionException e) {
            throw new CompilerBusyException(BUSY_MESSAGE, RETRY_AFTER);
        }

        try {
            return pending.get(timeout.plus(REAPING_GRACE).toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            pending.cancel(true);
            log.warn("compiler process outlived {} plus the reaping grace", timeout);
            return CompilationResult.Failure.of(TIMEOUT_MESSAGE);
        } catch (ExecutionException e) {
            Throwable cause = e.getCause();
            if (cause instanceof CompilerUnavailableException unavailable) {
                throw unavailable;
            }
            if (closed && cause instanceof InterruptedException) {
                log.info("compilation abandoned because the compiler is shutting down");
            } else {
                log.error("compiler process failed", cause);
            }
            throw new CompilerUnavailableException(UNAVAILABLE_MESSAGE, RETRY_AFTER);
        } catch (InterruptedException e) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while compiling", e);
        }
    }

    private CompilationResult run(SourceUnit unit) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).redirectError(Redirect.INHERIT).start();
        running.add(process);

        AtomicBoolean killed = new AtomicBoolean();
        ScheduledFuture<?> deadline = null;

        try {
            if (closed) {
                throw new CompilerUnavailableException(UNAVAILABLE_MESSAGE, RETRY_AFTER);
            }
            deadline = watchdog.schedule(() -> {
                killed.set(true);
                process.destroyForcibly();
            }, timeout.toMillis(), TimeUnit.MILLISECONDS);

            writeRequest(process, unit);
            byte[] payload = process.getInputStream().readNBytes(MAX_RESULT_BYTES + 1);
            if (payload.length > MAX_RESULT_BYTES) {
                log.error("compiler process wrote more than {} bytes to the result channel", MAX_RESULT_BYTES);
                throw new CompilerUnavailableException(UNAVAILABLE_MESSAGE, RETRY_AFTER);
            }
            int exitCode = process.waitFor();

            CompilationResult result = parse(payload);
            if (result != null) {
                return result;
            }
            if (killed.get()) {
                log.warn("compilation exceeded {}; the compiler process was killed", timeout);
                return CompilationResult.Failure.of(TIMEOUT_MESSAGE);
            }
            log.error("compiler process exited with {} and no result", exitCode);
            throw new CompilerUnavailableException(UNAVAILABLE_MESSAGE, RETRY_AFTER);
        } finally {
            if (deadline != null) {
                deadline.cancel(false);
            }
            process.destroyForcibly();
            running.remove(process);
        }
    }

    private void writeRequest(Process process, SourceUnit unit) {
        try (OutputStream stdin = process.getOutputStream()) {
            objectMapper.writeValue(stdin, CompilerProcessProtocol.Request.of(unit));
        } catch (IOException | JacksonException e) {
            log.debug("could not hand the source to the compiler process", e);
        }
    }

    private CompilationResult parse(byte[] payload) {
        if (payload.length == 0) {
            return null;
        }
        try {
            return objectMapper.readValue(payload, CompilerProcessProtocol.Payload.class).toResult();
        } catch (JacksonException | IllegalArgumentException e) {
            log.error("compiler process wrote {} bytes that are not a result document", payload.length, e);
            return null;
        }
    }

    @Override
    public void close() {
        closed = true;
        pool.shutdownNow();
        watchdog.shutdownNow();
        running.forEach(Process::destroyForcibly);
    }

    private static ThreadPoolExecutor boundedPool(int maxConcurrentCompilations) {
        ThreadPoolExecutor pool = new ThreadPoolExecutor(maxConcurrentCompilations, maxConcurrentCompilations,
                30, TimeUnit.SECONDS, new SynchronousQueue<>(), daemonThreads("compile-fork"),
                new ThreadPoolExecutor.AbortPolicy());
        pool.allowCoreThreadTimeOut(true);
        return pool;
    }

    private static List<String> command(List<String> extraChildVmOptions) {
        List<String> command = new ArrayList<>();
        command.add(Path.of(System.getProperty("java.home"), "bin", "java").toString());
        command.addAll(CHILD_VM_OPTIONS);
        command.addAll(extraChildVmOptions);
        command.add("-cp");
        command.add(System.getProperty("java.class.path"));
        command.add(CompilerProcessMain.class.getName());
        return List.copyOf(command);
    }

    private static ThreadFactory daemonThreads(String prefix) {
        AtomicInteger counter = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, prefix + "-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }
}
