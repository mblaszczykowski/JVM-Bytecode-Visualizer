package dev.jvmvisualizer.compileservice.compiler;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Compiles a single Java source string with the JDK compiler, entirely in memory.
 *
 * <p>The service compiles and never executes: no class loader is created, no bytes reach the
 * filesystem, and annotation processing — the one path that runs foreign code inside javac — is
 * disabled. The user class path is emptied as well, so the only types reachable from the source
 * are the {@code --release 21} platform classes.
 */
public class InMemoryCompiler {

    static final String TIMEOUT_MESSAGE = "compilation timed out";
    static final String MULTIPLE_CLASSES_MESSAGE =
            "this service compiles a single top-level class; nested, local and anonymous classes are not "
                    + "supported because the visualizer loads exactly one class file";
    static final String NO_OUTPUT_MESSAGE = "compilation produced no class file";

    private static final Logger log = LoggerFactory.getLogger(InMemoryCompiler.class);

    private static final List<String> OPTIONS = List.of(
            "-proc:none",       // annotation processors would execute code inside javac
            "--release", "21",  // pins the class file version the browser interpreter expects
            "-g");              // LocalVariableTable, so the UI can name locals

    /** Compilations run on their own thread; daemon so a wedged javac cannot hold up shutdown. */
    private static final ThreadFactory COMPILER_THREADS = runnable -> {
        Thread thread = new Thread(runnable, "javac-worker");
        thread.setDaemon(true);
        return thread;
    };

    private static final String FALLBACK_UNIT_NAME = "CompilationUnit";

    private final JavaCompiler compiler;
    private final Duration timeout;

    public InMemoryCompiler(Duration timeout) {
        this.timeout = Objects.requireNonNull(timeout, "timeout");
        this.compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("no system Java compiler available; the service requires a JDK, not a JRE");
        }
    }

    /** The exact option list handed to javac. Exposed so tests can pin the hardening flags. */
    public static List<String> options() {
        return OPTIONS;
    }

    public CompilationResult compile(String source) {
        String unitName = SourceNames.publicTypeName(source).orElse(FALLBACK_UNIT_NAME);
        DiagnosticCollector<JavaFileObject> collector = new DiagnosticCollector<>();

        try (StandardJavaFileManager standardFileManager =
                     compiler.getStandardFileManager(collector, null, StandardCharsets.UTF_8);
             InMemoryFileManager fileManager = new InMemoryFileManager(standardFileManager)) {

            // Left unset, javac would fall back to the working directory as the user class path.
            standardFileManager.setLocation(StandardLocation.CLASS_PATH, List.of());

            JavaCompiler.CompilationTask task = compiler.getTask(
                    null, fileManager, collector, OPTIONS, null, List.of(new StringSource(unitName, source)));

            boolean succeeded = call(task);
            List<CompilerDiagnostic> diagnostics = collector.getDiagnostics().stream()
                    .map(CompilerDiagnostic::from)
                    .toList();

            return succeeded ? classify(fileManager.classFiles(), diagnostics)
                             : new CompilationResult.Failure(diagnostics);

        } catch (TimeoutException e) {
            log.warn("compilation exceeded {}", timeout);
            return CompilationResult.Failure.of(TIMEOUT_MESSAGE);
        } catch (IOException e) {
            throw new UncheckedIOException("failed to release the in-memory file manager", e);
        }
    }

    private boolean call(JavaCompiler.CompilationTask task) throws TimeoutException {
        ExecutorService executor = Executors.newSingleThreadExecutor(COMPILER_THREADS);
        Future<Boolean> result = executor.submit(task);
        try {
            return result.get(timeout.toMillis(), TimeUnit.MILLISECONDS);
        } catch (ExecutionException e) {
            // javac blew up on the source rather than reporting a diagnostic; treat it as a failed
            // compilation instead of a 500 — the client can only act on diagnostics anyway.
            log.warn("javac failed unexpectedly", e.getCause());
            return false;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while compiling", e);
        } finally {
            result.cancel(true);
            executor.shutdownNow();
        }
    }

    private CompilationResult classify(Map<String, byte[]> classFiles, List<CompilerDiagnostic> diagnostics) {
        if (classFiles.isEmpty()) {
            return new CompilationResult.Failure(withError(diagnostics, NO_OUTPUT_MESSAGE));
        }
        if (classFiles.size() > 1) {
            return new CompilationResult.Failure(withError(diagnostics, MULTIPLE_CLASSES_MESSAGE));
        }
        Map.Entry<String, byte[]> only = classFiles.entrySet().iterator().next();
        return new CompilationResult.Success(only.getKey(), only.getValue(), diagnostics);
    }

    private static List<CompilerDiagnostic> withError(List<CompilerDiagnostic> diagnostics, String message) {
        List<CompilerDiagnostic> all = new ArrayList<>(diagnostics);
        all.add(CompilerDiagnostic.error(message));
        return List.copyOf(all);
    }
}
