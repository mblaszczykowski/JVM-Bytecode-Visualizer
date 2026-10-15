package dev.jvmvisualizer.compileservice.api;

import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import dev.jvmvisualizer.compileservice.compiler.CompilerBusyException;
import dev.jvmvisualizer.compileservice.compiler.CompilerUnavailableException;
import dev.jvmvisualizer.compileservice.error.ErrorCode;
import dev.jvmvisualizer.compileservice.error.RequestTooLargeException;
import dev.jvmvisualizer.compileservice.service.InvalidSourceException;
import java.time.Duration;
import java.util.Locale;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;
import tools.jackson.core.exc.StreamConstraintsException;

@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private static final String INTERNAL_ERROR_MESSAGE = "the service failed to handle this request";

    @ExceptionHandler(InvalidSourceException.class)
    ResponseEntity<ErrorResponse> handleInvalidSource(InvalidSourceException e) {
        return ResponseEntity.badRequest().body(ErrorResponse.of(e.error(), e.getMessage()));
    }

    @ExceptionHandler(CompilerBusyException.class)
    ResponseEntity<ErrorResponse> handleBusy(CompilerBusyException e) {
        return unavailable(ErrorCode.COMPILER_BUSY, e.getMessage(), e.retryAfter());
    }

    @ExceptionHandler(CompilerUnavailableException.class)
    ResponseEntity<ErrorResponse> handleCompilerUnavailable(CompilerUnavailableException e) {
        return unavailable(ErrorCode.COMPILER_UNAVAILABLE, e.getMessage(), e.retryAfter());
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        log.error("unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ErrorResponse.of(ErrorCode.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE));
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException e,
                                                                  HttpHeaders headers, HttpStatusCode status,
                                                                  WebRequest request) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return handleExceptionInternal(e, ErrorResponse.of(ErrorCode.INVALID_REQUEST, message), headers, status,
                request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException e,
                                                                  HttpHeaders headers, HttpStatusCode status,
                                                                  WebRequest request) {
        Throwable cause = NestedExceptionUtils.getMostSpecificCause(e);
        ErrorResponse body = switch (cause) {
            case RequestTooLargeException tooLarge ->
                    ErrorResponse.of(ErrorCode.SOURCE_TOO_LARGE, tooLarge.getMessage());
            case StreamConstraintsException ignored -> ErrorResponse.of(ErrorCode.SOURCE_TOO_LARGE,
                    "the source field is larger than this service accepts");
            default -> ErrorResponse.of(ErrorCode.INVALID_REQUEST,
                    "request body must be a JSON object with a source field");
        };
        return handleExceptionInternal(e, body, headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception e, Object body, HttpHeaders headers,
                                                             HttpStatusCode status, WebRequest request) {
        return super.handleExceptionInternal(e, asErrorResponse(body, status), headers, status, request);
    }

    private static ResponseEntity<ErrorResponse> unavailable(ErrorCode error, String message, Duration retryAfter) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(retryAfter.toSeconds()))
                .body(ErrorResponse.of(error, message));
    }

    private static Object asErrorResponse(Object body, HttpStatusCode status) {
        if (body instanceof ErrorResponse) {
            return body;
        }
        if (status.is5xxServerError()) {
            return ErrorResponse.of(ErrorCode.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE);
        }
        HttpStatus resolved = HttpStatus.resolve(status.value());
        if (resolved == null) {
            return new ErrorResponse(ErrorCode.REQUEST_ERROR.code(), "the request was rejected");
        }
        return new ErrorResponse(resolved.name().toLowerCase(Locale.ROOT).replace('_', '-'),
                resolved.getReasonPhrase());
    }
}
