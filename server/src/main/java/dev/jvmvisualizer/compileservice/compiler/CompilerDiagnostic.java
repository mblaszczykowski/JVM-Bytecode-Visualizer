package dev.jvmvisualizer.compileservice.compiler;

import java.util.Locale;
import javax.tools.Diagnostic;
import javax.tools.JavaFileObject;

public record CompilerDiagnostic(Diagnostic.Kind kind, Integer line, Integer column, String message) {

    public static CompilerDiagnostic error(String message) {
        return new CompilerDiagnostic(Diagnostic.Kind.ERROR, null, null, message);
    }

    static CompilerDiagnostic from(Diagnostic<? extends JavaFileObject> diagnostic) {
        return new CompilerDiagnostic(
                diagnostic.getKind(),
                position(diagnostic.getLineNumber()),
                position(diagnostic.getColumnNumber()),
                diagnostic.getMessage(Locale.ROOT));
    }

    private static Integer position(long value) {
        return value == Diagnostic.NOPOS ? null : Math.toIntExact(value);
    }
}
