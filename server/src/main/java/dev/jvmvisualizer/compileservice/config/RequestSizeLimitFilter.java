package dev.jvmvisualizer.compileservice.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Refuses a body that is too large to be a source before a byte of it is buffered.
 *
 * <p>The size check used to live in the service, on the already-parsed string: a 19 MB {@code
 * source} was fully read, decoded and held in the heap, and only then rejected — an out-of-memory
 * exit reachable with one request. Content-Length is the cheap half of the fix; the wrapper is the
 * other half, because a chunked request has no Content-Length to check and an attacker picks the
 * framing.
 *
 * <p>It answers 400 rather than 413: the client contract has 400 for "your source is not
 * acceptable" and the frontend renders that message inline, while a 413 would read as an outage.
 */
public class RequestSizeLimitFilter extends OncePerRequestFilter {

    public static final String ERROR = "source-too-large";

    private final long maxRequestBytes;
    private final long maxSourceBytes;
    private final ObjectMapper objectMapper;

    public RequestSizeLimitFilter(long maxRequestBytes, long maxSourceBytes, ObjectMapper objectMapper) {
        this.maxRequestBytes = maxRequestBytes;
        this.maxSourceBytes = maxSourceBytes;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        if (request.getContentLengthLong() > maxRequestBytes) {
            reject(response, request.getContentLengthLong());
            return;
        }

        LimitedRequest limited = new LimitedRequest(request, maxRequestBytes);
        try {
            chain.doFilter(limited, response);
        } catch (RequestTooLargeException e) {
            // Only reachable when the declared length lied or there was none at all.
            if (!response.isCommitted()) {
                response.reset();
                reject(response, e.read());
            }
        }
    }

    private void reject(HttpServletResponse response, long bytes) throws IOException {
        response.setStatus(HttpStatus.BAD_REQUEST.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getOutputStream(), new ErrorResponse(ERROR,
                "the request body is %s bytes; a source of at most %d bytes is accepted"
                        .formatted(bytes < 0 ? "more than " + maxRequestBytes : String.valueOf(bytes),
                                maxSourceBytes)));
    }

    /**
     * Signals a body that outgrew the cap while being read. Message converters wrap it, so the
     * exception handler unwraps the cause chain to answer with the same error as the early check.
     */
    public static final class RequestTooLargeException extends IOException {

        private final long read;

        RequestTooLargeException(long read) {
            super("request body exceeds the accepted size");
            this.read = read;
        }

        public long read() {
            return read;
        }
    }

    private static final class LimitedRequest extends HttpServletRequestWrapper {

        private final long limit;
        private ServletInputStream stream;
        private BufferedReader reader;

        private LimitedRequest(HttpServletRequest request, long limit) {
            super(request);
            this.limit = limit;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) {
                stream = new LimitedStream(super.getInputStream(), limit);
            }
            return stream;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            if (reader == null) {
                reader = new BufferedReader(new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
            }
            return reader;
        }
    }

    private static final class LimitedStream extends ServletInputStream {

        private final ServletInputStream delegate;
        private final long limit;
        private long read;

        private LimitedStream(ServletInputStream delegate, long limit) {
            this.delegate = delegate;
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int value = delegate.read();
            if (value >= 0) {
                count(1);
            }
            return value;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int count = delegate.read(buffer, offset, length);
            if (count > 0) {
                count(count);
            }
            return count;
        }

        private void count(int bytes) throws RequestTooLargeException {
            read += bytes;
            if (read > limit) {
                throw new RequestTooLargeException(read);
            }
        }

        @Override
        public boolean isFinished() {
            return delegate.isFinished();
        }

        @Override
        public boolean isReady() {
            return delegate.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            delegate.setReadListener(listener);
        }

        @Override
        public int available() throws IOException {
            return delegate.available();
        }

        @Override
        public void close() throws IOException {
            delegate.close();
        }
    }
}
