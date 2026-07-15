package dev.jvmvisualizer.compileservice.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "compile")
public record CompileProperties(
        @NotBlank String allowedOrigin,
        @NotNull DataSize maxSourceSize,
        @NotNull Duration timeout,
        @NotNull @Valid RateLimit rateLimit) {

    /**
     * @param trustForwardedFor whether {@code X-Forwarded-For} identifies the client; only enable
     *                          it behind a proxy that overwrites the header, otherwise callers can
     *                          forge it and bypass the limit
     */
    public record RateLimit(@Positive int requestsPerMinute, boolean trustForwardedFor) {
    }
}
