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
