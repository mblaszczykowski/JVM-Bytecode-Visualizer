package dev.jvmvisualizer.compileservice.error;

public enum ErrorCode {

    NO_PUBLIC_CLASS("no-public-class"),
    SOURCE_TOO_LARGE("source-too-large"),
    INVALID_REQUEST("invalid-request"),
    RATE_LIMIT_EXCEEDED("rate-limit-exceeded"),
    COMPILER_BUSY("compiler-busy"),
    COMPILER_UNAVAILABLE("compiler-unavailable"),
    INTERNAL_ERROR("internal-error"),
    REQUEST_ERROR("request-error");

    private final String code;

    ErrorCode(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
