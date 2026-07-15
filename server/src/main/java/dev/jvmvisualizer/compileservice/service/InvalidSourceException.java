package dev.jvmvisualizer.compileservice.service;

/** Source rejected before javac is invoked; surfaces as 400 with {@link #error()} as the code. */
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
