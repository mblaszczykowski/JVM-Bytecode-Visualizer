package dev.jvmvisualizer.compileservice.compiler;

import java.util.Base64;
import java.util.List;
import javax.tools.Diagnostic;

final class CompilerProcessProtocol {

    private CompilerProcessProtocol() {
    }

    record Request(String typeName, String source) {

        static Request of(SourceUnit unit) {
            return new Request(unit.typeName(), unit.source());
        }

        SourceUnit toUnit() {
            return new SourceUnit(typeName, source);
        }
    }

    record Payload(boolean success, String className, String classFileBase64,
                   List<DiagnosticPayload> diagnostics) {

        static Payload of(CompilationResult result) {
            List<DiagnosticPayload> diagnostics = result.diagnostics().stream().map(DiagnosticPayload::of).toList();
            return switch (result) {
                case CompilationResult.Success success -> new Payload(true, success.className(),
                        Base64.getEncoder().encodeToString(success.classBytes()), diagnostics);
                case CompilationResult.Failure ignored -> new Payload(false, null, null, diagnostics);
            };
        }

        CompilationResult toResult() {
            List<CompilerDiagnostic> converted = diagnostics == null ? List.of()
                    : diagnostics.stream().map(DiagnosticPayload::toDiagnostic).toList();
            if (!success || className == null || classFileBase64 == null) {
                return new CompilationResult.Failure(converted);
            }
            return new CompilationResult.Success(className, Base64.getDecoder().decode(classFileBase64), converted);
        }
    }

    record DiagnosticPayload(String kind, Integer line, Integer column, String message) {

        static DiagnosticPayload of(CompilerDiagnostic diagnostic) {
            return new DiagnosticPayload(diagnostic.kind().name(), diagnostic.line(), diagnostic.column(),
                    diagnostic.message());
        }

        CompilerDiagnostic toDiagnostic() {
            return new CompilerDiagnostic(kindOf(kind), line, column, message == null ? "" : message);
        }

        private static Diagnostic.Kind kindOf(String name) {
            for (Diagnostic.Kind candidate : Diagnostic.Kind.values()) {
                if (candidate.name().equals(name)) {
                    return candidate;
                }
            }
            return Diagnostic.Kind.OTHER;
        }
    }
}
