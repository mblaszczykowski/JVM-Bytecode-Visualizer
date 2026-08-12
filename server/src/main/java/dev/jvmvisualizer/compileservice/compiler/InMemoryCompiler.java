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

public class InMemoryCompiler implements SourceCompiler {

    static final String MULTIPLE_CLASSES_MESSAGE =
            "this service compiles a single top-level class; nested, local and anonymous classes are not "
                    + "supported because the visualizer loads exactly one class file";
    static final String NO_OUTPUT_MESSAGE = "compilation produced no class file";
    static final String CRASH_MESSAGE = "the compiler failed on this source";

    private static final Logger log = LoggerFactory.getLogger(InMemoryCompiler.class);

    private static final List<String> OPTIONS = List.of(
            "-proc:none",
            "--release", "21",
            "-g");

    private static final int MAX_LOGGED_COMPILER_OUTPUT = 2_000;

    private final JavaCompiler compiler;

    public InMemoryCompiler() {
        this.compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) {
            throw new IllegalStateException("no system Java compiler available; the service requires a JDK, not a JRE");
        }
    }

    public static List<String> options() {
        return OPTIONS;
    }

    @Override
    public CompilationResult compile(SourceUnit unit) {
        DiagnosticCollector<JavaFileObject> collector = new DiagnosticCollector<>();
        StringWriter compilerOutput = new StringWriter();

        try (StandardJavaFileManager standardFileManager =
                     compiler.getStandardFileManager(collector, null, StandardCharsets.UTF_8);
             InMemoryFileManager fileManager = new InMemoryFileManager(standardFileManager)) {

            standardFileManager.setLocation(StandardLocation.CLASS_PATH, List.of());

            JavaCompiler.CompilationTask task = compiler.getTask(compilerOutput, fileManager, collector, OPTIONS, null,
                    List.of(new StringSource(unit.typeName(), unit.source())));

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
