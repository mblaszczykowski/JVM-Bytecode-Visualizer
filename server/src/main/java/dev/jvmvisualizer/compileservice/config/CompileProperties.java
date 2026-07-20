package dev.jvmvisualizer.compileservice.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.annotation.Validated;

/**
 * @param maxRequestSize hard cap on the request body, checked before anything is buffered; it has
 *                       to leave room for the JSON envelope around a {@code maxSourceSize} source
 */
@Validated
@ConfigurationProperties(prefix = "compile")
public record CompileProperties(
        @NotBlank String allowedOrigin,
        @NotNull DataSize maxSourceSize,
        @NotNull DataSize maxRequestSize,
        @NotNull Duration timeout,
        @Positive int maxConcurrentCompilations,
        @NotNull @Valid RateLimit rateLimit) {

    public CompileProperties {
        // Constraints the annotations cannot express; nulls are left to the validator's messages.
        if ("*".equals(allowedOrigin)) {
            throw new IllegalArgumentException(
                    "compile.allowed-origin must name the frontend origin: '*' would let any page drive the compiler");
        }
        if (timeout != null && (timeout.isNegative() || timeout.isZero())) {
            throw new IllegalArgumentException("compile.timeout must be positive, was " + timeout);
        }
        if (maxSourceSize != null && maxSourceSize.toBytes() <= 0) {
            throw new IllegalArgumentException("compile.max-source-size must be positive");
        }
        if (maxSourceSize != null && maxRequestSize != null && maxRequestSize.toBytes() < maxSourceSize.toBytes()) {
            throw new IllegalArgumentException("compile.max-request-size must leave room for a "
                    + maxSourceSize + " source plus its JSON envelope");
        }
    }

    /**
     * @param trustForwardedFor whether {@code X-Forwarded-For} identifies the client; only enable
     *                          it behind a proxy that appends to the header
     * @param trustedProxyHops  how many proxies append to {@code X-Forwarded-For} between the
     *                          client and this service; the client address is that many entries
     *                          from the right, and everything to the left of it is caller-controlled
     */
    public record RateLimit(@Positive int requestsPerMinute, boolean trustForwardedFor,
                            @PositiveOrZero int trustedProxyHops) {

        public RateLimit {
            if (trustForwardedFor && trustedProxyHops < 1) {
                throw new IllegalArgumentException(
                        "compile.rate-limit.trusted-proxy-hops must be at least 1 when the header is trusted");
            }
        }
    }
}
