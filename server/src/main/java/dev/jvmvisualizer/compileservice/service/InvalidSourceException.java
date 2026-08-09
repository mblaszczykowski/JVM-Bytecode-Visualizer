package dev.jvmvisualizer.compileservice.service;

public class InvalidSourceException extends RuntimeException {

    private final String error;

    public InvalidSourceException(String error, String message) {
        super(message);
        this.error = error;
    }

    public String error() {
        return error;
    }
}
