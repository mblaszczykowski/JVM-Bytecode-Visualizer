package dev.jvmvisualizer.compileservice.config;

import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import dev.jvmvisualizer.compileservice.error.ErrorCode;
import dev.jvmvisualizer.compileservice.error.RequestTooLargeException;
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
import tools.jackson.databind.ObjectMapper;

public class RequestSizeLimitFilter extends OncePerRequestFilter {

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

        long declared = request.getContentLengthLong();
        if (declared > maxRequestBytes) {
            response.setStatus(HttpStatus.BAD_REQUEST.value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            objectMapper.writeValue(response.getOutputStream(),
                    ErrorResponse.of(ErrorCode.SOURCE_TOO_LARGE, tooLargeMessage(declared, maxSourceBytes)));
            return;
        }

        chain.doFilter(new LimitedRequest(request, maxRequestBytes, maxSourceBytes), response);
    }

    static String tooLargeMessage(long bytes, long maxSourceBytes) {
        return "the request body is at least %d bytes; a source of at most %d bytes is accepted"
                .formatted(bytes, maxSourceBytes);
    }

    private static final class LimitedRequest extends HttpServletRequestWrapper {

        private final long limit;
        private final long maxSourceBytes;
        private ServletInputStream stream;
        private BufferedReader reader;

        private LimitedRequest(HttpServletRequest request, long limit, long maxSourceBytes) {
            super(request);
            this.limit = limit;
            this.maxSourceBytes = maxSourceBytes;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) {
                stream = new LimitedStream(super.getInputStream(), limit, maxSourceBytes);
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
        private final long maxSourceBytes;
        private long read;

        private LimitedStream(ServletInputStream delegate, long limit, long maxSourceBytes) {
            this.delegate = delegate;
            this.limit = limit;
            this.maxSourceBytes = maxSourceBytes;
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
                throw new RequestTooLargeException(tooLargeMessage(read, maxSourceBytes));
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
