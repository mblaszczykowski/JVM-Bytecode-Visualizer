package dev.jvmvisualizer.compileservice.compiler;

import java.util.List;

public sealed interface CompilationResult {

    List<CompilerDiagnostic> diagnostics();

    record Success(String className, byte[] classBytes, List<CompilerDiagnostic> diagnostics)
            implements CompilationResult {
    }

    record Failure(List<CompilerDiagnostic> diagnostics) implements CompilationResult {

        public static Failure of(String message) {
            return new Failure(List.of(CompilerDiagnostic.error(message)));
        }
    }
}
