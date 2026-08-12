package dev.jvmvisualizer.compileservice.service;

import dev.jvmvisualizer.compileservice.error.ErrorCode;

public class InvalidSourceException extends RuntimeException {

    private final ErrorCode error;

    public InvalidSourceException(ErrorCode error, String message) {
        super(message);
        this.error = error;
    }

    public ErrorCode error() {
        return error;
    }
}
