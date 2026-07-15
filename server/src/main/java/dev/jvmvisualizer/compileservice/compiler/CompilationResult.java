package dev.jvmvisualizer.compileservice.compiler;

import java.util.List;

public sealed interface CompilationResult {

    List<CompilerDiagnostic> diagnostics();

    /** Exactly one class file was produced; {@code className} is its binary name. */
    record Success(String className, byte[] classBytes, List<CompilerDiagnostic> diagnostics)
            implements CompilationResult {
    }

    /** Compilation failed, timed out, or produced something the visualizer cannot consume. */
    record Failure(List<CompilerDiagnostic> diagnostics) implements CompilationResult {

        public static Failure of(String message) {
            return new Failure(List.of(CompilerDiagnostic.error(message)));
        }
    }
}
