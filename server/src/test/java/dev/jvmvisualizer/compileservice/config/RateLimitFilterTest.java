package dev.jvmvisualizer.compileservice.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

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
    void cannotBeEscapedBySendingASecondForwardedForHeaderLine() throws Exception {
        RateLimitFilter filter = filter(true, ONE_PROXY);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7");
        }

        assertThat(callWith(filter, "10.0.0.1", List.of("198.51.100.1", "203.0.113.7")).getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(callWith(filter, "10.0.0.1", List.of("198.51.100.2", "198.51.100.3", "203.0.113.7")).getStatus())
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
    void keysOnEveryShapeOfIpv6Literal() throws Exception {
        List<String> literals = List.of("::", "::1", "fe80::1", "2001:db8:0:0:0:0:0:1",
                "2001:0db8:85a3:0000:0000:8a2e:0370:7334", "::ffff:203.0.113.7", "2001:db8::7:1.2.3.4",
                "1:2:3:4:5:6:7::");

        for (String literal : literals) {
            RateLimitFilter filter = filter(true, ONE_PROXY);
            for (int i = 1; i <= LIMIT; i++) {
                assertThat(call(filter, "10.0.0." + i, literal).getStatus()).as(literal)
                        .isEqualTo(HttpStatus.OK.value());
            }

            assertThat(call(filter, "10.0.0.9", literal).getStatus()).as(literal)
                    .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        }
    }

    @Test
    void equivalentSpellingsShareOneRateLimitWindowWithoutDns() throws Exception {
        RecordingResolverProvider.reset();
        List<List<String>> spellings = List.of(
                List.of("2001:db8::a", "2001:0DB8:0:0:0:0:0:000a", "[2001:db8::A]:443"),
                List.of("203.0.113.7", "203.000.113.007", "::ffff:203.0.113.7"));

        for (List<String> variants : spellings) {
            RateLimitFilter filter = filter(true);
            for (int i = 0; i < LIMIT; i++) {
                assertThat(call(filter, "10.0.0.1", variants.get(i)).getStatus()).isEqualTo(HttpStatus.OK.value());
            }
            assertThat(call(filter, "10.0.0.1", variants.get(0)).getStatus())
                    .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        }
        assertThat(RecordingResolverProvider.namesLookedUp()).isEmpty();
    }

    @Test
    void anEmptyTrustedEntryFallsBackToTheRemoteAddress() throws Exception {
        RateLimitFilter filter = filter(true);
        for (int i = 0; i < LIMIT; i++) {
            call(filter, "10.0.0.1");
        }
        assertThat(call(filter, "10.0.0.1", "203.0.113.7,").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    void fallsBackToTheRemoteAddressWhenTheRequestNeverTraversedTheTrustedProxies() throws Exception {
        RateLimitFilter filter = filter(true, 2);

        for (int i = 1; i <= LIMIT; i++) {
            call(filter, "10.0.0.1", "203.0.113.7");
        }

        assertThat(call(filter, "10.0.0.1", "198.51.100.5").getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    void fallsBackToTheRemoteAddressForEntriesThatOnlyLookLikeIpv6() throws Exception {
        String longerThanAnyIpAddress = "0001:0002:0003:0004:0005:0006:0007:0008:0009:0010:0011:0012";
        List<String> notLiterals = List.of("1::2::3", "gggg::1", "12345::1", "1:2:3:4:5:6:7:8:9", ":1:2:3:4:5:6:7",
                "1:2:3:4:5:6:7", "::ffff:203.0.113.300", "fe80::1%eth0", "::ffff:1.2.3.4:5", "",
                longerThanAnyIpAddress, "[]", "1.2.3.4444", "1.2.3.x");

        for (String entry : notLiterals) {
            RateLimitFilter filter = filter(true, ONE_PROXY);
            for (int i = 1; i <= LIMIT; i++) {
                assertThat(call(filter, "10.0.0.1", entry).getStatus()).as(entry)
                        .isEqualTo(HttpStatus.OK.value());
            }

            assertThat(call(filter, "10.0.0.1").getStatus()).as(entry)
                    .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        }
    }

    @Test
    void neverResolvesAForwardedForEntry() throws Exception {
        RecordingResolverProvider.reset();
        RateLimitFilter filter = filter(true, ONE_PROXY);

        call(filter, "10.0.0.1", "zz" + "a".repeat(18) + ".attacker.example:1:2");
        call(filter, "10.0.0.1", "a:b.attacker.example:1");
        call(filter, "10.0.0.1", "attacker.example");
        call(filter, "10.0.0.1", "[2001:db8::1]:443");

        assertThat(RecordingResolverProvider.namesLookedUp()).isEmpty();
    }

    @Test
    void theRecorderWouldHaveSeenAResolutionHadOneHappened() {
        RecordingResolverProvider.reset();
        String name = "absent-" + UUID.randomUUID() + ".invalid";

        assertThatThrownBy(() -> InetAddress.getByName(name)).isInstanceOf(UnknownHostException.class);

        assertThat(RecordingResolverProvider.namesLookedUp()).contains(name);
    }

    @Test
    void doesNotChargePreflightRequestsAgainstTheLimit() throws Exception {
        RateLimitFilter filter = filter(false);

        for (int i = 0; i < 10; i++) {
            assertThat(options(filter, true).getStatus()).isEqualTo(HttpStatus.OK.value());
        }

        for (int i = 1; i <= LIMIT; i++) {
            assertThat(call(filter, "10.0.0.1").getStatus()).isEqualTo(HttpStatus.OK.value());
        }
    }

    @Test
    void chargesAnOptionsRequestThatIsNotAPreflight() throws Exception {
        RateLimitFilter filter = filter(false);

        for (int i = 1; i <= LIMIT; i++) {
            assertThat(options(filter, false).getStatus()).isEqualTo(HttpStatus.OK.value());
        }

        assertThat(options(filter, false).getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
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
                JsonMapper.builder().build(), clock);
    }

    private MockHttpServletResponse call(RateLimitFilter filter, String remoteAddress) throws Exception {
        return call(filter, remoteAddress, null);
    }

    private MockHttpServletResponse options(RateLimitFilter filter, boolean preflight) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS", "/api/compile");
        request.setRemoteAddr("10.0.0.1");
        if (preflight) {
            request.addHeader(HttpHeaders.ORIGIN, "http://localhost:5173");
            request.addHeader(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST");
        }
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, new MockFilterChain());
        return response;
    }

    private MockHttpServletResponse call(RateLimitFilter filter, String remoteAddress, String forwardedFor)
            throws Exception {
        return callWith(filter, remoteAddress, forwardedFor == null ? List.of() : List.of(forwardedFor));
    }

    private MockHttpServletResponse callWith(RateLimitFilter filter, String remoteAddress,
                                             List<String> forwardedForLines) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/compile");
        request.setRemoteAddr(remoteAddress);
        forwardedForLines.forEach(line -> request.addHeader("X-Forwarded-For", line));
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
