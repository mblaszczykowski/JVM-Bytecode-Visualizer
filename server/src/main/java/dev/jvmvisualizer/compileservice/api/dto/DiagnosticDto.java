package dev.jvmvisualizer.compileservice.api.dto;

public record DiagnosticDto(String kind, Integer line, Integer column, String message) {
}
