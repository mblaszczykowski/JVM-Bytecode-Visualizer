package dev.jvmvisualizer.compileservice.compiler;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
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

/**
 * Compiles in a child JVM and kills that JVM when the deadline passes.
 *
 * <p>An in-process timeout was a lie: {@code Future.cancel(true)} raises an interrupt flag that
 * javac never polls, so a source with pathological type inference kept a thread at 100 % CPU long
 * after the client had its answer, one thread per request. {@code destroyForcibly()} on a child
 * process is the only construction that actually reclaims a running javac.
 *
 * <p>The child inherits the same hardening — it runs the very same {@link InMemoryCompiler}, so
 * {@code -proc:none}, {@code --release 21}, the empty class path and the null class loader come
 * with it — plus a small heap and stack of its own. Concurrency is bounded: a saturated pool
 * rejects rather than letting every Tomcat thread spawn a JVM, and the caller gets 503.
 *
 * <p>The child is launched with this process's {@code java.class.path}, so the deployment has to
 * expose one that a plain {@code java -cp} understands — see the Dockerfile, which runs the
 * application exploded for exactly that reason.
 */
public class ForkedCompiler implements SourceCompiler, AutoCloseable {

    static final String TIMEOUT_MESSAGE = "compilation timed out";
    static final String UNAVAILABLE_MESSAGE = "the compiler could not be run; the compilation was abandoned";
    static final String BUSY_MESSAGE = "the compile service is at capacity, retry in a moment";

    private static final Logger log = LoggerFactory.getLogger(ForkedCompiler.class);

    /** Small enough to bound one request, large enough for javac on a 64 KiB source. */
    private static final List<String> CHILD_VM_OPTIONS = List.of(
            "-Xmx128m",
            "-Xss1m",
            "-XX:+UseSerialGC",          // one short-lived compilation, no concurrent collector needed
            "-XX:TieredStopAtLevel=1",   // startup dominates the wall clock here, not peak throughput
            "-XX:-UsePerfData");         // no hsperfdata file per compilation

    /** Reading the child's output and reaping it may outlive the compile budget by this much. */
    private static final Duration REAPING_GRACE = Duration.ofSeconds(5);
    private static final Duration RETRY_AFTER = Duration.ofSeconds(5);
    private static final int MAX_LOGGED_STDERR = 2_000;

    private final Duration timeout;
    private final List<String> command;
    private final ThreadPoolExecutor pool;
    private final ScheduledExecutorService watchdog;
    private final Set<Process> running = ConcurrentHashMap.newKeySet();
    private final ObjectMapper objectMapper = new ObjectMapper();
    private volatile boolean closed;

    public ForkedCompiler(Duration timeout, int maxConcurrentCompilations) {
        this.timeout = Objects.requireNonNull(timeout, "timeout");
        this.command = command();
        this.pool = boundedPool(maxConcurrentCompilations);
        this.watchdog = Executors.newSingleThreadScheduledExecutor(daemonThreads("compile-watchdog"));
        log.info("compiling in child processes: at most {} at a time, {} each, command {}",
                maxConcurrentCompilations, timeout, command);
        warnIfTheChildCannotBeLaunched();
    }

    /**
     * An executable Spring Boot jar keeps the application classes under {@code BOOT-INF}, where a
     * plain {@code java -cp} cannot reach them, and {@code java.class.path} is then the jar alone.
     * Deployments have to run exploded — the Dockerfile does; say so at start-up rather than once
     * per failed request.
     */
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
    public CompilationResult compile(String source) {
        Future<CompilationResult> pending;
        try {
            pending = pool.submit(() -> run(source));
        } catch (RejectedExecutionException e) {
            throw new CompilerBusyException(BUSY_MESSAGE, RETRY_AFTER);
        }

        try {
            return pending.get(timeout.plus(REAPING_GRACE).toMillis(), TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // The watchdog owns the kill; this only stops the request from waiting any longer.
            pending.cancel(true);
            log.warn("compiler process outlived {} plus the reaping grace", timeout);
            return CompilationResult.Failure.of(TIMEOUT_MESSAGE);
        } catch (ExecutionException e) {
            log.error("compiler process failed", e.getCause());
            return CompilationResult.Failure.of(UNAVAILABLE_MESSAGE);
        } catch (InterruptedException e) {
            pending.cancel(true);
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while compiling", e);
        }
    }

    private CompilationResult run(String source) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).start();
        running.add(process);

        AtomicBoolean killed = new AtomicBoolean();
        ScheduledFuture<?> deadline = null;

        try {
            // Registered first, then checked: a shutdown either sees this process in the set or
            // this sees the shutdown, and an accepted task can never leave a JVM behind.
            if (closed) {
                return CompilationResult.Failure.of(UNAVAILABLE_MESSAGE);
            }
            deadline = watchdog.schedule(() -> {
                killed.set(true);
                process.destroyForcibly();
            }, timeout.toMillis(), TimeUnit.MILLISECONDS);

            writeSource(process, source);
            // The kill closes both pipes, so neither read can outlast the deadline.
            byte[] payload = process.getInputStream().readAllBytes();
            int exitCode = process.waitFor();

            CompilationResult result = parse(payload);
            if (result != null) {
                logStderr(process, exitCode);
                return result;
            }
            if (killed.get()) {
                log.warn("compilation exceeded {}; the compiler process was killed", timeout);
                return CompilationResult.Failure.of(TIMEOUT_MESSAGE);
            }
            log.error("compiler process exited with {} and no result: {}", exitCode, stderrOf(process));
            return CompilationResult.Failure.of(UNAVAILABLE_MESSAGE);
        } finally {
            if (deadline != null) {
                deadline.cancel(false);
            }
            process.destroyForcibly(); // no orphan survives this method, whatever went wrong
            running.remove(process);
        }
    }

    private void writeSource(Process process, String source) {
        try (OutputStream stdin = process.getOutputStream()) {
            stdin.write(source.getBytes(StandardCharsets.UTF_8));
        } catch (IOException e) {
            // The child died before reading its input; the exit status below is the real story.
            log.debug("could not hand the source to the compiler process", e);
        }
    }

    private CompilationResult parse(byte[] payload) {
        if (payload.length == 0) {
            return null;
        }
        try {
            return objectMapper.readValue(payload, CompilerProcessProtocol.Payload.class).toResult();
        } catch (IOException | IllegalArgumentException e) {
            log.error("compiler process wrote {} bytes that are not a result document", payload.length, e);
            return null;
        }
    }

    private void logStderr(Process process, int exitCode) {
        String stderr = stderrOf(process);
        if (!stderr.isEmpty()) {
            log.warn("compiler process (exit {}) wrote to stderr: {}", exitCode, stderr);
        }
    }

    /** Only ever called once the process has exited, so the pipe holds a bounded, complete message. */
    private String stderrOf(Process process) {
        try {
            String stderr = new String(process.getErrorStream().readAllBytes(), StandardCharsets.UTF_8).strip();
            return stderr.length() > MAX_LOGGED_STDERR ? stderr.substring(0, MAX_LOGGED_STDERR) + "…" : stderr;
        } catch (IOException e) {
            return "";
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

    private static List<String> command() {
        List<String> command = new ArrayList<>();
        command.add(Path.of(System.getProperty("java.home"), "bin", "java").toString());
        command.addAll(CHILD_VM_OPTIONS);
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
