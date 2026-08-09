package dev.jvmvisualizer.compileservice.api.dto;

public record DiagnosticDto(Integer line, Integer column, String kind, String message) {
}
