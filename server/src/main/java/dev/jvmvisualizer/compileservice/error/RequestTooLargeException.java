package dev.jvmvisualizer.compileservice.error;

import java.io.IOException;

public class RequestTooLargeException extends IOException {

    public RequestTooLargeException(String message) {
        super(message);
    }
}
