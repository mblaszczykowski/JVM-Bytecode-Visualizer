package dev.jvmvisualizer.compileservice.compiler;

import java.util.Arrays;
import java.util.List;
import java.util.Objects;

public sealed interface CompilationResult {

    List<CompilerDiagnostic> diagnostics();

    final class Success implements CompilationResult {

        private final String className;
        private final byte[] classBytes;
        private final List<CompilerDiagnostic> diagnostics;

        public Success(String className, byte[] classBytes, List<CompilerDiagnostic> diagnostics) {
            this.className = Objects.requireNonNull(className, "className");
            this.classBytes = Objects.requireNonNull(classBytes, "classBytes").clone();
            this.diagnostics = List.copyOf(diagnostics);
        }

        public String className() {
            return className;
        }

        public byte[] classBytes() {
            return classBytes.clone();
        }

        @Override
        public List<CompilerDiagnostic> diagnostics() {
            return diagnostics;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Success success
                    && className.equals(success.className)
                    && Arrays.equals(classBytes, success.classBytes)
                    && diagnostics.equals(success.diagnostics);
        }

        @Override
        public int hashCode() {
            return Objects.hash(className, Arrays.hashCode(classBytes), diagnostics);
        }

        @Override
        public String toString() {
            return "Success[className=%s, classBytes=%d bytes, diagnostics=%s]"
                    .formatted(className, classBytes.length, diagnostics);
        }
    }

    record Failure(List<CompilerDiagnostic> diagnostics) implements CompilationResult {

        public Failure {
            diagnostics = List.copyOf(diagnostics);
        }

        public static Failure of(String message) {
            return new Failure(List.of(CompilerDiagnostic.error(message)));
        }
    }
}
