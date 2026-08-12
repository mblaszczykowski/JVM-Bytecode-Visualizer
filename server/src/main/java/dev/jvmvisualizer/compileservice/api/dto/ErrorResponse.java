package dev.jvmvisualizer.compileservice.api.dto;

import dev.jvmvisualizer.compileservice.error.ErrorCode;

public record ErrorResponse(String error, String message) {

    public static ErrorResponse of(ErrorCode error, String message) {
        return new ErrorResponse(error.code(), message);
    }
}
