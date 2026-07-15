package dev.jvmvisualizer.compileservice.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class RateLimitFilterTest {

    private static final int LIMIT = 3;

    private final MutableClock clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));

    @Test
    void allowsRequestsUpToTheLimitAndBlocksTheNextOne() throws Exception {
        RateLimitFilter filter = filter(false);

        for (int i = 1; i <= LIMIT; i++) {
            assertThat(call(filter, "10.0.0.1").getStatus()).isEqualTo(HttpStatus.OK.value());
        }

        MockHttpServletResponse blocked = call(filter, "10.0.0.1");
        assertThat(blocked.getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(blocked.getHeader(HttpHeaders.RETRY_AFTER)).isEqualTo("60");
        assertThat(blocked.getContentAsString()).contains("rate-limit-exceeded");
    }

    @Test
    void startsAFreshWindowAfterAMinute() throws Exception {
        RateLimitFilter filter = filter(false);
        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1");
        }
        assertThat(call(filter, "10.0.0.1").getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());

        clock.advance(Duration.ofSeconds(61));

        assertThat(call(filter, "10.0.0.1").getStatus()).isEqualTo(HttpStatus.OK.value());
    }

    @Test
    void countsEachClientAddressSeparately() throws Exception {
        RateLimitFilter filter = filter(false);
        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1");
        }

        assertThat(call(filter, "10.0.0.1").getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(call(filter, "10.0.0.2").getStatus()).isEqualTo(HttpStatus.OK.value());
    }

    @Test
    void ignoresForwardedForHeaderUnlessProxiesAreTrusted() throws Exception {
        RateLimitFilter filter = filter(false);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113." + i);
        }

        // All requests came from the same remote address, so the forged header buys nothing.
        assertThat(call(filter, "10.0.0.1", "203.0.113.9").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    void usesTheFirstForwardedForEntryWhenProxiesAreTrusted() throws Exception {
        RateLimitFilter filter = filter(true);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7, 10.0.0.1");
        }

        assertThat(call(filter, "10.0.0.1", "203.0.113.7").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(call(filter, "10.0.0.1", "203.0.113.8").getStatus()).isEqualTo(HttpStatus.OK.value());
    }

    private RateLimitFilter filter(boolean trustForwardedFor) {
        return new RateLimitFilter(new CompileProperties.RateLimit(LIMIT, trustForwardedFor),
                new ObjectMapper(), clock);
    }

    private MockHttpServletResponse call(RateLimitFilter filter, String remoteAddress) throws Exception {
        return call(filter, remoteAddress, null);
    }

    private MockHttpServletResponse call(RateLimitFilter filter, String remoteAddress, String forwardedFor)
            throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/compile");
        request.setRemoteAddr(remoteAddress);
        if (forwardedFor != null) {
            request.addHeader("X-Forwarded-For", forwardedFor);
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }

    private static final class MutableClock extends Clock {

        private Instant now;

        private MutableClock(Instant now) {
            this.now = now;
        }

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }
}
