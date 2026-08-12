package dev.jvmvisualizer.compileservice.compiler;

import java.time.Duration;

public class CompilerUnavailableException extends RuntimeException {

    private final Duration retryAfter;

    public CompilerUnavailableException(String message, Duration retryAfter) {
        super(message);
        this.retryAfter = retryAfter;
    }

    public Duration retryAfter() {
        return retryAfter;
    }
}
