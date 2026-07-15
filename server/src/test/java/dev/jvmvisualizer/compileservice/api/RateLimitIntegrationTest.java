package dev.jvmvisualizer.compileservice.api;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The limit is enforced by a servlet filter, so it applies to every request that reaches the API —
 * including the malformed ones used here, which keeps the test from running eleven compilations.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "compile.rate-limit.requests-per-minute=10")
class RateLimitIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void blocksTheEleventhRequestFromTheSameClientWithinAMinute() throws Exception {
        for (int i = 1; i <= 10; i++) {
            mockMvc.perform(post("/api/compile").contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isBadRequest());
        }

        mockMvc.perform(post("/api/compile").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("rate-limit-exceeded"));
    }
}
