package dev.jvmvisualizer.compileservice.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.util.unit.DataSize;

class CompilePropertiesTest {

    private static final String ORIGIN = "http://localhost:5173";
    private static final DataSize SOURCE_LIMIT = DataSize.ofKilobytes(64);
    private static final DataSize REQUEST_LIMIT = DataSize.ofKilobytes(256);
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    @Test
    void refusesAWildcardOrigin() {
        assertThatThrownBy(() -> properties("*", SOURCE_LIMIT, REQUEST_LIMIT, TIMEOUT))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.allowed-origin");
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "file:///tmp/editor", "https://example.com/editor", "https://example.com?x=1",
            "https://example.com#editor", "https://user:secret@example.com", "https://example.com:65536",
            "https://*.example.com", " https://example.com", "https://example.com,https://other.example"})
    void refusesValuesThatBrowsersCannotSendAsAnOrigin(String origin) {
        assertThatThrownBy(() -> properties(origin, SOURCE_LIMIT, REQUEST_LIMIT, TIMEOUT))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.allowed-origin");
    }

    @ParameterizedTest
    @ValueSource(strings = {"http://localhost:5173", "https://example.com", "https://example.com/", "http://[::1]:8080"})
    void acceptsHttpOriginsIncludingLoopbackAndATrailingSlash(String origin) {
        assertThatCode(() -> properties(origin, SOURCE_LIMIT, REQUEST_LIMIT, TIMEOUT)).doesNotThrowAnyException();
    }

    @Test
    void refusesATimeoutBelowTheWatchdogClockResolution() {
        assertThatThrownBy(() -> properties(ORIGIN, SOURCE_LIMIT, REQUEST_LIMIT, Duration.ofNanos(1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.timeout");
    }

    @Test
    void refusesATimeoutThatIsNotPositive() {
        assertThatThrownBy(() -> properties(ORIGIN, SOURCE_LIMIT, REQUEST_LIMIT, Duration.ZERO))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.timeout");

        assertThatThrownBy(() -> properties(ORIGIN, SOURCE_LIMIT, REQUEST_LIMIT, Duration.ofSeconds(-1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.timeout");
    }

    @Test
    void refusesASourceLimitThatIsNotPositive() {
        assertThatThrownBy(() -> properties(ORIGIN, DataSize.ofBytes(0), REQUEST_LIMIT, TIMEOUT))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.max-source-size");
    }

    @Test
    void refusesARequestLimitThatLeavesNoRoomForTheSource() {
        assertThatThrownBy(() -> properties(ORIGIN, SOURCE_LIMIT, DataSize.ofKilobytes(32), TIMEOUT))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.max-request-size");
    }

    @Test
    void refusesToTrustTheForwardedForHeaderWithoutAProxyHop() {
        assertThatThrownBy(() -> new CompileProperties.RateLimit(10, true, 0))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("compile.rate-limit.trusted-proxy-hops");
    }

    @Test
    void leavesAbsentValuesToBeanValidationRatherThanFailingToConstruct() {
        assertThatCode(() -> properties(null, null, null, null)).doesNotThrowAnyException();
        assertThatCode(() -> properties(ORIGIN, SOURCE_LIMIT, null, TIMEOUT)).doesNotThrowAnyException();
    }

    private static CompileProperties properties(String allowedOrigin, DataSize maxSourceSize,
                                                DataSize maxRequestSize, Duration timeout) {
        return new CompileProperties(allowedOrigin, maxSourceSize, maxRequestSize, timeout, 2,
                new CompileProperties.RateLimit(10, false, 0));
    }
}
