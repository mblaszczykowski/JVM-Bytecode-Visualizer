package dev.jvmvisualizer.compileservice.api;

import com.fasterxml.jackson.core.exc.StreamConstraintsException;
import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import dev.jvmvisualizer.compileservice.compiler.CompilerBusyException;
import dev.jvmvisualizer.compileservice.config.RequestSizeLimitFilter;
import dev.jvmvisualizer.compileservice.service.InvalidSourceException;
import java.util.Locale;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

@RestControllerAdvice
class ApiExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    private static final String INTERNAL_ERROR = "internal-error";
    private static final String INTERNAL_ERROR_MESSAGE = "the service failed to handle this request";

    @ExceptionHandler(InvalidSourceException.class)
    ResponseEntity<ErrorResponse> handleInvalidSource(InvalidSourceException e) {
        return ResponseEntity.badRequest().body(new ErrorResponse(e.error(), e.getMessage()));
    }

    @ExceptionHandler(CompilerBusyException.class)
    ResponseEntity<ErrorResponse> handleBusy(CompilerBusyException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(e.retryAfter().toSeconds()))
                .body(new ErrorResponse("compiler-busy", e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        log.error("unhandled exception", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(new ErrorResponse(INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE));
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException e,
                                                                  HttpHeaders headers, HttpStatusCode status,
                                                                  WebRequest request) {
        String message = e.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return handleExceptionInternal(e, new ErrorResponse("invalid-request", message), headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(HttpMessageNotReadableException e,
                                                                  HttpHeaders headers, HttpStatusCode status,
                                                                  WebRequest request) {
        Throwable cause = NestedExceptionUtils.getMostSpecificCause(e);
        ErrorResponse body = switch (cause) {
            case RequestSizeLimitFilter.RequestTooLargeException tooLarge -> new ErrorResponse(
                    RequestSizeLimitFilter.ERROR,
                    "the request body is at least %d bytes and was refused".formatted(tooLarge.read()));
            case StreamConstraintsException ignored -> new ErrorResponse(RequestSizeLimitFilter.ERROR,
                    "the source field is larger than this service accepts");
            default -> new ErrorResponse("invalid-request",
                    "request body must be a JSON object with a source field");
        };
        return handleExceptionInternal(e, body, headers, status, request);
    }

    @Override
    protected ResponseEntity<Object> handleExceptionInternal(Exception e, Object body, HttpHeaders headers,
                                                             HttpStatusCode status, WebRequest request) {
        return super.handleExceptionInternal(e, asErrorResponse(body, status), headers, status, request);
    }

    private static Object asErrorResponse(Object body, HttpStatusCode status) {
        if (body instanceof ErrorResponse) {
            return body;
        }
        if (status.is5xxServerError()) {
            return new ErrorResponse(INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE);
        }
        return new ErrorResponse(errorCode(status), detailOf(body, status));
    }

    private static String errorCode(HttpStatusCode status) {
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved == null ? "request-error" : resolved.name().toLowerCase(Locale.ROOT).replace('_', '-');
    }

    private static String detailOf(Object body, HttpStatusCode status) {
        if (body instanceof ProblemDetail problem && problem.getDetail() != null) {
            return problem.getDetail();
        }
        HttpStatus resolved = HttpStatus.resolve(status.value());
        return resolved == null ? "the request was rejected" : resolved.getReasonPhrase();
    }
}
