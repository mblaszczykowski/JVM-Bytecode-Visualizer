package dev.jvmvisualizer.compileservice.compiler;

import java.util.Objects;

public record SourceUnit(String typeName, String source) {

    public SourceUnit {
        Objects.requireNonNull(typeName, "typeName");
        Objects.requireNonNull(source, "source");
    }
}
