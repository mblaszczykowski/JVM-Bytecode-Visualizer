package dev.jvmvisualizer.compileservice.service;

import dev.jvmvisualizer.compileservice.compiler.SourceNames;
import dev.jvmvisualizer.compileservice.config.CompileProperties;
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
        long bytes = utf8Length(source);
        if (bytes > maxSourceBytes) {
            throw new InvalidSourceException("source-too-large",
                    "source is %d bytes, the limit is %d bytes".formatted(bytes, maxSourceBytes));
        }
        if (SourceNames.publicTypeName(source).isEmpty()) {
            throw new InvalidSourceException("no-public-class",
                    "source must declare a public top-level class");
        }
    }

    /** Counts the encoded bytes; {@code getBytes} would allocate a second copy of the source. */
    private static long utf8Length(String source) {
        long length = 0;
        for (int i = 0; i < source.length(); i++) {
            char c = source.charAt(i);
            if (c < 0x80) {
                length += 1;
            } else if (c < 0x800) {
                length += 2;
            } else if (Character.isHighSurrogate(c) && i + 1 < source.length()
                    && Character.isLowSurrogate(source.charAt(i + 1))) {
                length += 4;
                i++;
            } else {
                length += 3;
            }
        }
        return length;
    }
}
