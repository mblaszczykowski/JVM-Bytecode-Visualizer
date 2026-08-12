package dev.jvmvisualizer.compileservice.service;

import dev.jvmvisualizer.compileservice.compiler.SourceNames;
import dev.jvmvisualizer.compileservice.compiler.SourceUnit;
import dev.jvmvisualizer.compileservice.config.CompileProperties;
import dev.jvmvisualizer.compileservice.error.ErrorCode;
import org.springframework.stereotype.Component;

@Component
public class SourceValidator {

    private final long maxSourceBytes;

    SourceValidator(CompileProperties properties) {
        this.maxSourceBytes = properties.maxSourceSize().toBytes();
    }

    public SourceUnit validate(String source) {
        if (source == null || source.isBlank()) {
            throw new InvalidSourceException(ErrorCode.EMPTY_SOURCE, "source must not be empty");
        }
        long bytes = utf8Length(source);
        if (bytes > maxSourceBytes) {
            throw new InvalidSourceException(ErrorCode.SOURCE_TOO_LARGE,
                    "source is %d bytes, the limit is %d bytes".formatted(bytes, maxSourceBytes));
        }
        return SourceNames.publicTypeName(source)
                .map(typeName -> new SourceUnit(typeName, source))
                .orElseThrow(() -> new InvalidSourceException(ErrorCode.NO_PUBLIC_CLASS,
                        "source must declare a public top-level class"));
    }

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
