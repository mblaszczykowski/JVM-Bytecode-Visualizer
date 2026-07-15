package dev.jvmvisualizer.compileservice.service;

import dev.jvmvisualizer.compileservice.compiler.SourceNames;
import dev.jvmvisualizer.compileservice.config.CompileProperties;
import java.nio.charset.StandardCharsets;
import org.springframework.stereotype.Component;

/**
 * Everything that must be rejected with 400 rather than answered with diagnostics: an empty
 * source, one that is too large to be worth compiling, and one that declares no public type
 * (the visualizer has nothing to load, and javac needs the name for the compilation unit).
 */
@Component
public class SourceValidator {

    private final long maxSourceBytes;

    SourceValidator(CompileProperties properties) {
        this.maxSourceBytes = properties.maxSourceSize().toBytes();
    }

    public void validate(String source) {
        if (source == null || source.isBlank()) {
            throw new InvalidSourceException("empty-source", "source must not be empty");
        }
        long bytes = source.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > maxSourceBytes) {
            throw new InvalidSourceException("source-too-large",
                    "source is %d bytes, the limit is %d bytes".formatted(bytes, maxSourceBytes));
        }
        if (SourceNames.publicTypeName(source).isEmpty()) {
            throw new InvalidSourceException("no-public-class",
                    "source must declare a public top-level class");
        }
    }
}
