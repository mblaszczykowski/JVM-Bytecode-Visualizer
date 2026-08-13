package dev.jvmvisualizer.compileservice.config;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;
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
