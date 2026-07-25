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

/**
 * Filter order on {@code /api/*}: CORS, then the rate limit, then the size cap. CORS goes first so
 * that a throttled or rejected request still carries {@code Access-Control-Allow-Origin} and the
 * page can read the error it caused — MVC's own CORS handling runs far too late for that, after
 * every filter has had its say. The limit comes before the size check so that a flood of oversized
 * bodies is throttled like any other flood; both decisions are made from headers alone.
 */
@Configuration(proxyBeanMethods = false)
class WebConfig {

    private static final int CORS_ORDER = Ordered.HIGHEST_PRECEDENCE;
    private static final int RATE_LIMIT_ORDER = Ordered.HIGHEST_PRECEDENCE + 50;
    private static final int SIZE_LIMIT_ORDER = Ordered.HIGHEST_PRECEDENCE + 100;

    /** Room for the largest accepted source plus JSON escaping, and nothing beyond it. */
    private static final int MAX_JSON_STRING_LENGTH = 70 * 1024;

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

        // The browser probes /actuator/health before it reveals the editor, so that GET has to be
        // readable cross-origin too — otherwise the feature stays hidden on any split deployment.
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

    /** Scoped to the API so health checks are never throttled. */
    @Bean
    FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(ObjectMapper objectMapper) {
        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>(
                new RateLimitFilter(properties.rateLimit(), objectMapper, Clock.systemUTC()));
        registration.addUrlPatterns("/api/*");
        registration.setOrder(RATE_LIMIT_ORDER);
        return registration;
    }

    /**
     * Jackson's default 20 MB string limit is two orders of magnitude past anything this API can
     * use, and reaching it means the string was already allocated. This is the second line behind
     * the request size filter, for a body that stays small but declares one enormous field.
     */
    @Bean
    Jackson2ObjectMapperBuilderCustomizer boundedStringLength() {
        return builder -> builder.factory(JsonFactory.builder()
                .streamReadConstraints(StreamReadConstraints.builder()
                        .maxStringLength(MAX_JSON_STRING_LENGTH)
                        .build())
                .build());
    }
}
