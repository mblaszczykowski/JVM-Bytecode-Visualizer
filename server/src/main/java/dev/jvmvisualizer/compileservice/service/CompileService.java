package dev.jvmvisualizer.compileservice.service;

import dev.jvmvisualizer.compileservice.compiler.CompilationResult;
import dev.jvmvisualizer.compileservice.compiler.SourceCompiler;
import org.springframework.stereotype.Service;

@Service
public class CompileService {

    private final SourceValidator validator;
    private final SourceCompiler compiler;

    CompileService(SourceValidator validator, SourceCompiler compiler) {
        this.validator = validator;
        this.compiler = compiler;
    }

    public CompilationResult compile(String source) {
        return compiler.compile(validator.validate(source));
    }
}
