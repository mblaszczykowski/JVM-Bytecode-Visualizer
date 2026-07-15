package dev.jvmvisualizer.compileservice.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-IP fixed window throttle for the compile endpoint.
 *
 * <p>A fixed window (N requests per minute, counter reset on the first request of a new window) is
 * the cheapest thing that answers the actual threat here: one client looping javac calls. Its known
 * weakness — up to 2N requests around a window boundary — is irrelevant when N is 10 and each
 * request is capped at a 10 s compilation. bucket4j or a token bucket with a shared store would buy
 * smoothness and multi-instance correctness that a single free-tier container does not need; the
 * counters live in this process, so horizontal scaling would multiply the effective limit by the
 * number of instances.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Duration WINDOW = Duration.ofMinutes(1);
    private static final int MAX_TRACKED_CLIENTS = 10_000;
    private static final String X_FORWARDED_FOR = "X-Forwarded-For";

    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final int limit;
    private final boolean trustForwardedFor;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public RateLimitFilter(CompileProperties.RateLimit properties, ObjectMapper objectMapper, Clock clock) {
        this.limit = properties.requestsPerMinute();
        this.trustForwardedFor = properties.trustForwardedFor();
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {

        if (tryAcquire(clientKey(request))) {
            chain.doFilter(request, response);
            return;
        }

        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(WINDOW.toSeconds()));
        objectMapper.writeValue(response.getOutputStream(), new ErrorResponse("rate-limit-exceeded",
                "at most %d requests per minute are allowed".formatted(limit)));
    }

    private boolean tryAcquire(String client) {
        Instant now = clock.instant();
        evictStaleEntries(now);
        Window window = windows.compute(client,
                (key, current) -> current == null || current.hasExpired(now) ? new Window(now, 1) : current.next());
        return window.count() <= limit;
    }

    /** Bounded bookkeeping: sweep only once the map grows past what a real client base would need. */
    private void evictStaleEntries(Instant now) {
        if (windows.size() > MAX_TRACKED_CLIENTS) {
            windows.entrySet().removeIf(entry -> entry.getValue().hasExpired(now));
        }
    }

    private String clientKey(HttpServletRequest request) {
        if (trustForwardedFor) {
            String forwarded = request.getHeader(X_FORWARDED_FOR);
            if (forwarded != null && !forwarded.isBlank()) {
                return forwarded.split(",")[0].trim();
            }
        }
        return request.getRemoteAddr();
    }

    private record Window(Instant start, int count) {

        boolean hasExpired(Instant now) {
            return !now.isBefore(start.plus(WINDOW));
        }

        Window next() {
            return new Window(start, count + 1);
        }
    }
}
