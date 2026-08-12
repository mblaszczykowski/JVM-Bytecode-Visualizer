package dev.jvmvisualizer.compileservice.api;

import dev.jvmvisualizer.compileservice.api.dto.CompileRequest;
import dev.jvmvisualizer.compileservice.api.dto.CompileResponse;
import dev.jvmvisualizer.compileservice.api.dto.DiagnosticDto;
import dev.jvmvisualizer.compileservice.compiler.CompilationResult;
import dev.jvmvisualizer.compileservice.compiler.CompilerDiagnostic;
import dev.jvmvisualizer.compileservice.service.CompileService;
import jakarta.validation.Valid;
import java.util.Base64;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(path = "/api/compile", produces = MediaType.APPLICATION_JSON_VALUE)
class CompileController {

    private final CompileService compileService;

    CompileController(CompileService compileService) {
        this.compileService = compileService;
    }

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    CompileResponse compile(@Valid @RequestBody CompileRequest request) {
        return toResponse(compileService.compile(request.source()));
    }

    private static CompileResponse toResponse(CompilationResult result) {
        return switch (result) {
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
