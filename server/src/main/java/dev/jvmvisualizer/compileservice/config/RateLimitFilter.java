package dev.jvmvisualizer.compileservice.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Ticker;
import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

public class RateLimitFilter extends OncePerRequestFilter {

    private static final Duration WINDOW = Duration.ofMinutes(1);
    private static final int MAX_TRACKED_CLIENTS = 10_000;
    private static final String X_FORWARDED_FOR = "X-Forwarded-For";
    private static final int MAX_ADDRESS_LENGTH = 45;

    private final Cache<String, Window> windows;
    private final int limit;
    private final boolean trustForwardedFor;
    private final int trustedProxyHops;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public RateLimitFilter(CompileProperties.RateLimit properties, ObjectMapper objectMapper, Clock clock) {
        this.limit = properties.requestsPerMinute();
        this.trustForwardedFor = properties.trustForwardedFor();
        this.trustedProxyHops = properties.trustedProxyHops();
        this.objectMapper = objectMapper;
        this.clock = clock;
        Ticker ticker = () -> TimeUnit.MILLISECONDS.toNanos(clock.millis());
        this.windows = Caffeine.newBuilder()
                .maximumSize(MAX_TRACKED_CLIENTS)
                .expireAfterWrite(WINDOW)
                .ticker(ticker)
                .build();
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return HttpMethod.OPTIONS.matches(request.getMethod());
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
        Window window = windows.asMap().compute(client,
                (key, current) -> current == null || current.hasExpired(now) ? new Window(now, 1) : current.next());
        return window.count() <= limit;
    }

    long trackedClients() {
        windows.cleanUp();
        return windows.estimatedSize();
    }

    private String clientKey(HttpServletRequest request) {
        String remoteAddress = request.getRemoteAddr();
        if (!trustForwardedFor) {
            return remoteAddress;
        }
        String forwarded = request.getHeader(X_FORWARDED_FOR);
        if (forwarded == null || forwarded.isBlank()) {
            return remoteAddress;
        }
        List<String> entries = List.of(forwarded.split(","));
        int index = entries.size() - trustedProxyHops;
        if (index < 0) {
            return remoteAddress;
        }
        String candidate = normalize(entries.get(index).trim());
        return isIpLiteral(candidate) ? candidate : remoteAddress;
    }

    private static String normalize(String entry) {
        if (entry.startsWith("[")) {
            int end = entry.indexOf(']');
            return end < 0 ? entry : entry.substring(1, end);
        }
        int port = entry.indexOf(':');
        return port > 0 && entry.indexOf(':', port + 1) < 0 ? entry.substring(0, port) : entry;
    }

    private static boolean isIpLiteral(String candidate) {
        if (candidate.isEmpty() || candidate.length() > MAX_ADDRESS_LENGTH) {
            return false;
        }
        return candidate.indexOf(':') >= 0 ? isIpv6Literal(candidate) : isIpv4Literal(candidate);
    }

    private static boolean isIpv6Literal(String candidate) {
        try {
            InetAddress.getByName(candidate);
            return true;
        } catch (UnknownHostException e) {
            return false;
        }
    }

    private static boolean isIpv4Literal(String candidate) {
        String[] octets = candidate.split("\\.", -1);
        if (octets.length != 4) {
            return false;
        }
        for (String octet : octets) {
            if (octet.isEmpty() || octet.length() > 3) {
                return false;
            }
            for (int i = 0; i < octet.length(); i++) {
                if (octet.charAt(i) < '0' || octet.charAt(i) > '9') {
                    return false;
                }
            }
            if (Integer.parseInt(octet) > 255) {
                return false;
            }
        }
        return true;
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
