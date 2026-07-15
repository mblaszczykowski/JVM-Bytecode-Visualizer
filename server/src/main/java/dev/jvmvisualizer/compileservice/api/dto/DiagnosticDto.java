package dev.jvmvisualizer.compileservice.api.dto;

/** {@code line} and {@code column} are null for diagnostics that carry no source position. */
public record DiagnosticDto(Integer line, Integer column, String kind, String message) {
}
