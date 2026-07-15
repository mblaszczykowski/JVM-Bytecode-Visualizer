package dev.jvmvisualizer.compileservice.api.dto;

import java.util.List;

/**
 * Response body of {@code POST /api/compile}. Null fields stay in the payload on purpose: the
 * client contract defines {@code className} and {@code classFileBase64} as null on failure.
 */
public record CompileResponse(boolean success, String className, String classFileBase64,
                              List<DiagnosticDto> diagnostics) {

    public static CompileResponse compiled(String className, String classFileBase64,
                                           List<DiagnosticDto> diagnostics) {
        return new CompileResponse(true, className, classFileBase64, diagnostics);
    }

    public static CompileResponse failed(List<DiagnosticDto> diagnostics) {
        return new CompileResponse(false, null, null, diagnostics);
    }
}
