package dev.jvmvisualizer.compileservice.compiler;

import java.time.Duration;

/**
 * Every compile slot is taken. Surfaces as 503 with {@code Retry-After}: a queue of requests each
 * holding a JVM is worse for everyone than telling the caller to come back.
 */
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
