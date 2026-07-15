package dev.jvmvisualizer.compileservice.api;

import dev.jvmvisualizer.compileservice.api.dto.CompileRequest;
import dev.jvmvisualizer.compileservice.api.dto.CompileResponse;
import dev.jvmvisualizer.compileservice.service.CompileService;
import jakarta.validation.Valid;
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
        return compileService.compile(request.source());
    }
}
