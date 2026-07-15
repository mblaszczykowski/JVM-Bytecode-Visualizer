package dev.jvmvisualizer.compileservice.service;

import dev.jvmvisualizer.compileservice.api.dto.CompileResponse;
import dev.jvmvisualizer.compileservice.api.dto.DiagnosticDto;
import dev.jvmvisualizer.compileservice.compiler.CompilationResult;
import dev.jvmvisualizer.compileservice.compiler.CompilerDiagnostic;
import dev.jvmvisualizer.compileservice.compiler.InMemoryCompiler;
import java.util.Base64;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class CompileService {

    private final SourceValidator validator;
    private final InMemoryCompiler compiler;

    CompileService(SourceValidator validator, InMemoryCompiler compiler) {
        this.validator = validator;
        this.compiler = compiler;
    }

    public CompileResponse compile(String source) {
        validator.validate(source);

        return switch (compiler.compile(source)) {
            case CompilationResult.Success success -> CompileResponse.compiled(
                    success.className(),
                    Base64.getEncoder().encodeToString(success.classBytes()),
                    toDto(success.diagnostics()));
            case CompilationResult.Failure failure -> CompileResponse.failed(toDto(failure.diagnostics()));
        };
    }

    private static List<DiagnosticDto> toDto(List<CompilerDiagnostic> diagnostics) {
        return diagnostics.stream()
                .map(d -> new DiagnosticDto(d.line(), d.column(), d.kind().name(), d.message()))
                .toList();
    }
}
