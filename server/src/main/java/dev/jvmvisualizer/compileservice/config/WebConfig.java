package dev.jvmvisualizer.compileservice.config;

import dev.jvmvisualizer.compileservice.api.dto.ErrorResponse;
import dev.jvmvisualizer.compileservice.compiler.ForkedCompiler;
import dev.jvmvisualizer.compileservice.compiler.SourceCompiler;
import dev.jvmvisualizer.compileservice.error.ErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import java.util.List;
import org.springframework.boot.jackson.autoconfigure.JsonFactoryBuilderCustomizer;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.DefaultCorsProcessor;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.core.StreamReadConstraints;
import tools.jackson.databind.ObjectMapper;

@Configuration(proxyBeanMethods = false)
class WebConfig {

    private static final int CONTENT_TYPE_OPTIONS_ORDER = Ordered.HIGHEST_PRECEDENCE;
    private static final int CORS_ORDER = Ordered.HIGHEST_PRECEDENCE + 10;
    private static final int RATE_LIMIT_ORDER = Ordered.HIGHEST_PRECEDENCE + 50;
    private static final int SIZE_LIMIT_ORDER = Ordered.HIGHEST_PRECEDENCE + 100;

    private static final int SOURCE_FIELD_HEADROOM = 8 * 1024;

    private static final String[] API_AND_HEALTH = {"/api/*", "/actuator/health"};

    private final CompileProperties properties;

    WebConfig(CompileProperties properties) {
        this.properties = properties;
    }

    @Bean
    SourceCompiler sourceCompiler() {
        return new ForkedCompiler(properties.timeout(), properties.maxConcurrentCompilations());
    }

    @Bean
    FilterRegistrationBean<ContentTypeOptionsFilter> contentTypeOptionsFilterRegistration() {
        FilterRegistrationBean<ContentTypeOptionsFilter> registration =
                new FilterRegistrationBean<>(new ContentTypeOptionsFilter());
        registration.addUrlPatterns(API_AND_HEALTH);
        registration.setOrder(CONTENT_TYPE_OPTIONS_ORDER);
        return registration;
    }

    @Bean
    FilterRegistrationBean<CorsFilter> corsFilterRegistration(ObjectMapper objectMapper) {
        CorsConfiguration api = new CorsConfiguration();
        api.setAllowedOrigins(List.of(properties.allowedOrigin()));
        api.setAllowedMethods(List.of("POST", "OPTIONS"));
        api.setAllowedHeaders(List.of("Content-Type"));
        api.setExposedHeaders(List.of(HttpHeaders.RETRY_AFTER));
        api.setMaxAge(3600L);

        CorsConfiguration health = new CorsConfiguration();
        health.setAllowedOrigins(List.of(properties.allowedOrigin()));
        health.setAllowedMethods(List.of("GET", "OPTIONS"));
        health.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", api);
        source.registerCorsConfiguration("/actuator/health", health);

        CorsFilter corsFilter = new CorsFilter(source);
        corsFilter.setCorsProcessor(new ErrorShapedCorsProcessor(objectMapper));

        FilterRegistrationBean<CorsFilter> registration = new FilterRegistrationBean<>(corsFilter);
        registration.addUrlPatterns(API_AND_HEALTH);
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
    JsonFactoryBuilderCustomizer boundedStringLength() {
        int maxStringLength = Math.toIntExact(properties.maxSourceSize().toBytes()) + SOURCE_FIELD_HEADROOM;
        return builder -> builder.streamReadConstraints(StreamReadConstraints.builder()
                .maxStringLength(maxStringLength)
                .build());
    }

    static final class ContentTypeOptionsFilter extends OncePerRequestFilter {

        static final String HEADER = "X-Content-Type-Options";
        static final String NOSNIFF = "nosniff";

        @Override
        protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
                throws ServletException, IOException {
            response.setHeader(HEADER, NOSNIFF);
            chain.doFilter(request, response);
        }
    }

    private static final class ErrorShapedCorsProcessor extends DefaultCorsProcessor {

        private static final String REJECTED_MESSAGE = "this origin may not call the compile service";

        private final ObjectMapper objectMapper;

        private ErrorShapedCorsProcessor(ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        protected void rejectRequest(ServerHttpResponse response) throws IOException {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
            objectMapper.writeValue(response.getBody(), ErrorResponse.of(ErrorCode.REQUEST_ERROR, REJECTED_MESSAGE));
            response.flush();
        }
    }
}
