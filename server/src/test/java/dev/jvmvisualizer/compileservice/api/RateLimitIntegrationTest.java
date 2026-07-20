package dev.jvmvisualizer.compileservice.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * The limit is enforced by a servlet filter, so it applies to every request that reaches the API —
 * including the malformed ones used here, which keeps the test from running eleven compilations.
 * The counters are shared by the whole context, so each test uses an address of its own.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "compile.rate-limit.requests-per-minute=10")
class RateLimitIntegrationTest {

    private static final String ORIGIN = "http://localhost:5173";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void blocksTheEleventhRequestFromTheSameClientWithinAMinute() throws Exception {
        for (int i = 1; i <= 10; i++) {
            mockMvc.perform(compileRequest("10.1.0.1")).andExpect(status().isBadRequest());
        }

        mockMvc.perform(compileRequest("10.1.0.1"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate-limit-exceeded"));
    }

    /**
     * CORS runs in a filter ahead of the limiter for this: without the header the browser refuses
     * to hand the page the body, and "rate limited" becomes an unexplained network failure.
     */
    @Test
    void keepsTheResponseReadableByTheBrowserWhenItThrottles() throws Exception {
        for (int i = 1; i <= 10; i++) {
            mockMvc.perform(compileRequest("10.1.0.2").header(HttpHeaders.ORIGIN, ORIGIN));
        }

        mockMvc.perform(compileRequest("10.1.0.2").header(HttpHeaders.ORIGIN, ORIGIN))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN))
                .andExpect(jsonPath("$.error").value("rate-limit-exceeded"));
    }

    /** One preflight per compile: charging them would halve the limit the client actually gets. */
    @Test
    void doesNotSpendTheLimitOnPreflights() throws Exception {
        for (int i = 1; i <= 10; i++) {
            mockMvc.perform(options("/api/compile")
                            .with(remoteAddress("10.1.0.3"))
                            .header(HttpHeaders.ORIGIN, ORIGIN)
                            .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                    .andExpect(status().isOk());
        }

        mockMvc.perform(compileRequest("10.1.0.3")).andExpect(status().isBadRequest());
    }

    private static MockHttpServletRequestBuilder compileRequest(String remoteAddress) {
        return post("/api/compile")
                .with(remoteAddress(remoteAddress))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}");
    }

    private static RequestPostProcessor remoteAddress(String address) {
        return request -> {
            request.setRemoteAddr(address);
            return request;
        };
    }
}
