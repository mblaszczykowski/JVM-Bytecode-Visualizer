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
 *
 * <p>The counters live in a size-bounded cache. A plain map grew with every distinct address seen
 * in a window, which one attacker with a large address range turns into unbounded memory and an
 * O(n) sweep on every request.
 *
 * <p>Preflights are not counted: the browser sends one per compile, and answering {@code OPTIONS}
 * costs nothing. CORS headers are added by a filter ordered ahead of this one, so a 429 is readable
 * by the page that triggered it.
 */
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Duration WINDOW = Duration.ofMinutes(1);
    private static final int MAX_TRACKED_CLIENTS = 10_000;
    private static final String X_FORWARDED_FOR = "X-Forwarded-For";
    /** Longest possible textual IPv6 address, IPv4-mapped form included. */
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

    /** Preflights carry no source and no cost; charging them would halve the usable limit. */
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

    /** Number of clients currently held. Bounded by construction; the test pins that. */
    long trackedClients() {
        windows.cleanUp();
        return windows.estimatedSize();
    }

    /**
     * The client address, counted from the right. Everything to the left of the entry our own
     * proxies appended is written by the caller, so the leftmost entry — the one this used to
     * take — is a free choice of bucket for anyone wanting past the limit.
     */
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
            return remoteAddress; // fewer hops than configured: the chain is not what we expect
        }
        String candidate = normalize(entries.get(index).trim());
        return isIpLiteral(candidate) ? candidate : remoteAddress;
    }

    /** Strips the forms a proxy may add around the address itself: brackets and a port. */
    private static String normalize(String entry) {
        if (entry.startsWith("[")) {
            int end = entry.indexOf(']');
            return end < 0 ? entry : entry.substring(1, end);
        }
        int port = entry.indexOf(':');
        return port > 0 && entry.indexOf(':', port + 1) < 0 ? entry.substring(0, port) : entry;
    }

    /**
     * A forwarded header is attacker-controlled, so the entry has to parse as an address literal
     * before it can key anything — and it must never reach a name lookup. {@code getByName} only
     * resolves names when the argument holds no colon, which is why the IPv4 shape is checked by
     * hand and only the IPv6 form is handed to the JDK.
     */
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
