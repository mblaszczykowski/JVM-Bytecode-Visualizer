package dev.jvmvisualizer.compileservice.api.dto;

import jakarta.validation.constraints.NotBlank;

public record CompileRequest(@NotBlank(message = "source must not be empty") String source) {
}
