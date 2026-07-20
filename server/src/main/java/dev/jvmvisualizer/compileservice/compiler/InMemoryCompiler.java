package dev.jvmvisualizer.compileservice.compiler;

import java.io.IOException;
import java.io.StringWriter;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
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
 *
 * <p>This class is synchronous and has no timeout of its own: a runaway javac cannot be stopped
 * from inside the JVM that hosts it. {@link ForkedCompiler} runs it in a child process and kills
 * that process instead; {@link CompilerProcessMain} is the child's entry point.
 */
public class InMemoryCompiler implements SourceCompiler {

    static final String MULTIPLE_CLASSES_MESSAGE =
            "this service compiles a single top-level class; nested, local and anonymous classes are not "
                    + "supported because the visualizer loads exactly one class file";
    static final String NO_OUTPUT_MESSAGE = "compilation produced no class file";
    static final String CRASH_MESSAGE = "the compiler failed on this source";

    private static final Logger log = LoggerFactory.getLogger(InMemoryCompiler.class);

    private static final List<String> OPTIONS = List.of(
            "-proc:none",       // annotation processors would execute code inside javac
            "--release", "21",  // pins the class file version the browser interpreter expects
            "-g");              // LocalVariableTable, so the UI can name locals

    private static final String FALLBACK_UNIT_NAME = "CompilationUnit";

    /** javac's own crash dumps run to 1024 stack frames; the log only needs the head of one. */
    private static final int MAX_LOGGED_COMPILER_OUTPUT = 2_000;

    private final JavaCompiler compiler;

    public InMemoryCompiler() {
        this.compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("no system Java compiler available; the service requires a JDK, not a JRE");
        }
    }

    /** The exact option list handed to javac. Exposed so tests can pin the hardening flags. */
    public static List<String> options() {
        return OPTIONS;
    }

    @Override
    public CompilationResult compile(String source) {
        String unitName = SourceNames.publicTypeName(source).orElse(FALLBACK_UNIT_NAME);
        DiagnosticCollector<JavaFileObject> collector = new DiagnosticCollector<>();
        // Not null: javac writes its internal crash reports to this writer, and null means System.err.
        StringWriter compilerOutput = new StringWriter();

        try (StandardJavaFileManager standardFileManager =
                     compiler.getStandardFileManager(collector, null, StandardCharsets.UTF_8);
             InMemoryFileManager fileManager = new InMemoryFileManager(standardFileManager)) {

            // Left unset, javac would fall back to the working directory as the user class path.
            standardFileManager.setLocation(StandardLocation.CLASS_PATH, List.of());

            JavaCompiler.CompilationTask task = compiler.getTask(
                    compilerOutput, fileManager, collector, OPTIONS, null, List.of(new StringSource(unitName, source)));

            boolean succeeded = call(task);
            logCompilerOutput(compilerOutput);

            List<CompilerDiagnostic> diagnostics = collector.getDiagnostics().stream()
                    .map(CompilerDiagnostic::from)
                    .toList();

            return succeeded ? classify(fileManager.classFiles(), diagnostics) : failed(diagnostics);

        } catch (IOException e) {
            throw new UncheckedIOException("failed to release the in-memory file manager", e);
        }
    }

    private boolean call(JavaCompiler.CompilationTask task) {
        try {
            return task.call();
        } catch (RuntimeException | StackOverflowError e) {
            // javac blew up on the source rather than reporting a diagnostic; treat it as a failed
            // compilation instead of a 500 — the client can only act on diagnostics anyway.
            log.warn("javac failed unexpectedly: {}", e.toString());
            return false;
        }
    }

    private void logCompilerOutput(StringWriter compilerOutput) {
        String text = compilerOutput.toString().strip();
        if (text.isEmpty()) {
            return;
        }
        log.warn("javac wrote {} characters of internal output: {}", text.length(),
                text.length() > MAX_LOGGED_COMPILER_OUTPUT ? text.substring(0, MAX_LOGGED_COMPILER_OUTPUT) + "…" : text);
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

    /** A failure with no diagnostic breaks the client contract, so javac's silence gets a stand-in. */
    private static CompilationResult failed(List<CompilerDiagnostic> diagnostics) {
        return new CompilationResult.Failure(
                diagnostics.isEmpty() ? List.of(CompilerDiagnostic.error(CRASH_MESSAGE)) : diagnostics);
    }

    private static List<CompilerDiagnostic> withError(List<CompilerDiagnostic> diagnostics, String message) {
        List<CompilerDiagnostic> all = new ArrayList<>(diagnostics);
        all.add(CompilerDiagnostic.error(message));
        return List.copyOf(all);
    }
}
