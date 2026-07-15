package dev.jvmvisualizer.compileservice.api.dto;

/** Body of every 4xx that is not a compilation outcome. */
public record ErrorResponse(String error, String message) {
}
