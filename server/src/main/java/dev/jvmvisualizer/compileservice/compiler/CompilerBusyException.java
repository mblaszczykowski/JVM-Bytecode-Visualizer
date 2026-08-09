package dev.jvmvisualizer.compileservice.compiler;

import java.time.Duration;

public class CompilerBusyException extends RuntimeException {

    private final Duration retryAfter;

    public CompilerBusyException(String message, Duration retryAfter) {
        super(message);
        this.retryAfter = retryAfter;
    }

    public Duration retryAfter() {
        return retryAfter;
    }
}
