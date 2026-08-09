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
    private static final int ONE_PROXY = 1;

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

        assertThat(call(filter, "10.0.0.1", "203.0.113.9").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    void keysOnTheEntryTheTrustedProxyAppended() throws Exception {
        RateLimitFilter filter = filter(true, ONE_PROXY);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7");
        }

        assertThat(call(filter, "10.0.0.1", "203.0.113.7").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(call(filter, "10.0.0.1", "203.0.113.8").getStatus()).isEqualTo(HttpStatus.OK.value());
    }

    @Test
    void cannotBeEscapedByPrependingEntriesToTheHeader() throws Exception {
        RateLimitFilter filter = filter(true, ONE_PROXY);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7");
        }

        assertThat(call(filter, "10.0.0.1", "198.51.100.1, 203.0.113.7").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(call(filter, "10.0.0.1", "198.51.100.2, 198.51.100.3, 203.0.113.7").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    void countsBackTheConfiguredNumberOfAppendingProxies() throws Exception {
        RateLimitFilter filter = filter(true, 2);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7, 192.0.2.10");
        }

        assertThat(call(filter, "10.0.0.1", "203.0.113.7, 192.0.2.10").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(call(filter, "10.0.0.1", "203.0.113.8, 192.0.2.10").getStatus())
                .isEqualTo(HttpStatus.OK.value());
    }

    @Test
    void fallsBackToTheRemoteAddressWhenTheHeaderIsNotAnAddress() throws Exception {
        RateLimitFilter filter = filter(true, ONE_PROXY);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "not-an-address");
        }

        assertThat(call(filter, "10.0.0.1", "another.name").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    void acceptsAddressesCarryingAPortOrBrackets() throws Exception {
        RateLimitFilter filter = filter(true, ONE_PROXY);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7:41234");
        }

        assertThat(call(filter, "10.0.0.1", "203.0.113.7").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(call(filter, "10.0.0.1", "[2001:db8::1]:443").getStatus()).isEqualTo(HttpStatus.OK.value());
    }

    @Test
    void doesNotChargePreflightRequestsAgainstTheLimit() throws Exception {
        RateLimitFilter filter = filter(false);

        for (int i = 0; i < 10; i++) {
            MockHttpServletRequest preflight = new MockHttpServletRequest("OPTIONS", "/api/compile");
            preflight.setRemoteAddr("10.0.0.1");
            MockHttpServletResponse response = new MockHttpServletResponse();
            filter.doFilter(preflight, response, new MockFilterChain());
            assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        }

        for (int i = 1; i <= LIMIT; i++) {
            assertThat(call(filter, "10.0.0.1").getStatus()).isEqualTo(HttpStatus.OK.value());
        }
    }

    @Test
    void tracksABoundedNumberOfClients() throws Exception {
        RateLimitFilter filter = filter(false);

        for (int i = 0; i < 20_000; i++) {
            call(filter, "10.%d.%d.%d".formatted(i / 65536 % 256, i / 256 % 256, i % 256));
        }

        assertThat(filter.trackedClients()).isLessThanOrEqualTo(10_000);
    }

    private RateLimitFilter filter(boolean trustForwardedFor) {
        return filter(trustForwardedFor, trustForwardedFor ? ONE_PROXY : 0);
    }

    private RateLimitFilter filter(boolean trustForwardedFor, int trustedProxyHops) {
        return new RateLimitFilter(new CompileProperties.RateLimit(LIMIT, trustForwardedFor, trustedProxyHops),
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
