package dev.jvmvisualizer.compileservice.api;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

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

        ContractFixtures.record(ContractFixtures.Case.RATE_LIMIT_EXCEEDED, mockMvc.perform(compileRequest("10.1.0.1"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate-limit-exceeded"))
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "60"))
                .andReturn());
    }

    @Test
    void keepsTheResponseReadableByTheBrowserWhenItThrottles() throws Exception {
        for (int i = 1; i <= 10; i++) {
            mockMvc.perform(compileRequest("10.1.0.2").header(HttpHeaders.ORIGIN, ORIGIN));
        }

        mockMvc.perform(compileRequest("10.1.0.2").header(HttpHeaders.ORIGIN, ORIGIN))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGIN))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_EXPOSE_HEADERS,
                        containsString(HttpHeaders.RETRY_AFTER)))
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "60"))
                .andExpect(jsonPath("$.error").value("rate-limit-exceeded"));
    }

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
