package dev.jvmvisualizer.compileservice.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.annotation.Validated;

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
        if (allowedOrigin != null) {
            validateOrigin(allowedOrigin);
        }
        if (timeout != null && timeout.compareTo(Duration.ofMillis(1)) < 0) {
            throw new IllegalArgumentException("compile.timeout must be at least 1 ms, was " + timeout);
        }
        if (maxSourceSize != null && maxSourceSize.toBytes() <= 0) {
            throw new IllegalArgumentException("compile.max-source-size must be positive");
        }
        if (maxSourceSize != null && maxRequestSize != null && maxRequestSize.toBytes() < maxSourceSize.toBytes()) {
            throw new IllegalArgumentException("compile.max-request-size must leave room for a "
                    + maxSourceSize + " source plus its JSON envelope");
        }
    }

    private static void validateOrigin(String origin) {
        try {
            URI uri = URI.create(origin);
            if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme()))
                    || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || !(uri.getRawPath().isEmpty() || "/".equals(uri.getRawPath()))
                    || uri.getPort() > 65535) {
                throw new IllegalArgumentException();
            }
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("compile.allowed-origin must be one HTTP(S) origin without "
                    + "credentials, a path, a query or a fragment");
        }
    }

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
