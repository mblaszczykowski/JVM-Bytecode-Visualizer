package dev.jvmvisualizer.compileservice.config;

import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.jvmvisualizer.compileservice.compiler.ForkedCompiler;
import dev.jvmvisualizer.compileservice.compiler.SourceCompiler;
import java.time.Clock;
import java.util.List;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

@Configuration(proxyBeanMethods = false)
class WebConfig {

    private static final int CORS_ORDER = Ordered.HIGHEST_PRECEDENCE;
    private static final int RATE_LIMIT_ORDER = Ordered.HIGHEST_PRECEDENCE + 50;
    private static final int SIZE_LIMIT_ORDER = Ordered.HIGHEST_PRECEDENCE + 100;

    private static final int SOURCE_FIELD_HEADROOM = 8 * 1024;

    private final CompileProperties properties;

    WebConfig(CompileProperties properties) {
        this.properties = properties;
    }

    @Bean
    SourceCompiler sourceCompiler() {
        return new ForkedCompiler(properties.timeout(), properties.maxConcurrentCompilations());
    }

    @Bean
    FilterRegistrationBean<CorsFilter> corsFilterRegistration() {
        CorsConfiguration api = new CorsConfiguration();
        api.setAllowedOrigins(List.of(properties.allowedOrigin()));
        api.setAllowedMethods(List.of("POST", "OPTIONS"));
        api.setAllowedHeaders(List.of("Content-Type"));
        api.setMaxAge(3600L);

        CorsConfiguration health = new CorsConfiguration();
        health.setAllowedOrigins(List.of(properties.allowedOrigin()));
        health.setAllowedMethods(List.of("GET", "OPTIONS"));
        health.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", api);
        source.registerCorsConfiguration("/actuator/health", health);

        FilterRegistrationBean<CorsFilter> registration = new FilterRegistrationBean<>(new CorsFilter(source));
        registration.addUrlPatterns("/api/*", "/actuator/health");
        registration.setOrder(CORS_ORDER);
        return registration;
    }

    @Bean
    FilterRegistrationBean<RequestSizeLimitFilter> requestSizeLimitFilterRegistration(ObjectMapper objectMapper) {
        FilterRegistrationBean<RequestSizeLimitFilter> registration = new FilterRegistrationBean<>(
                new RequestSizeLimitFilter(properties.maxRequestSize().toBytes(),
                        properties.maxSourceSize().toBytes(), objectMapper));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(SIZE_LIMIT_ORDER);
        return registration;
    }

    @Bean
    FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(ObjectMapper objectMapper) {
        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>(
                new RateLimitFilter(properties.rateLimit(), objectMapper, Clock.systemUTC()));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(RATE_LIMIT_ORDER);
        return registration;
    }

    @Bean
    Jackson2ObjectMapperBuilderCustomizer boundedStringLength() {
        int maxStringLength = Math.toIntExact(properties.maxSourceSize().toBytes()) + SOURCE_FIELD_HEADROOM;
        return builder -> builder.factory(JsonFactory.builder()
                .streamReadConstraints(StreamReadConstraints.builder()
                        .maxStringLength(maxStringLength)
                        .build())
                .build());
    }
}
