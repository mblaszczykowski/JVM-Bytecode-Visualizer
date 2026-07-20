package dev.jvmvisualizer.compileservice.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.jvmvisualizer.compileservice.compiler.CompilerBusyException;
import dev.jvmvisualizer.compileservice.service.CompileService;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The frontend parses every response with a schema, so an error Spring answered on its own — a
 * wrong method, a wrong Content-Type, a path that does not exist — read as "the service is
 * broken" instead of "the request was wrong". Every error path has to carry {@code {error,
 * message}} and nothing else.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "compile.rate-limit.requests-per-minute=1000")
class ErrorContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockitoBean
    private CompileService compileService;

    @Test
    void answersAnUnknownPathWithTheErrorShape() throws Exception {
        assertErrorShape(mockMvc.perform(post("/api/nowhere").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("not-found"))
                .andReturn());
    }

    @Test
    void answersAWrongMethodWithTheErrorShape() throws Exception {
        assertErrorShape(mockMvc.perform(get("/api/compile"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.error").value("method-not-allowed"))
                .andReturn());
    }

    @Test
    void answersAWrongContentTypeWithTheErrorShape() throws Exception {
        assertErrorShape(mockMvc.perform(post("/api/compile").contentType(MediaType.TEXT_PLAIN).content("source"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("unsupported-media-type"))
                .andReturn());
    }

    @Test
    void answersAnUnexpectedFailureWithAnOpaqueError() throws Exception {
        given(compileService.compile(anyString())).willThrow(new IllegalStateException("connection string leaked"));

        MvcResult result = mockMvc.perform(post("/api/compile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"source\":\"public class A { }\"}"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error").value("internal-error"))
                .andReturn();

        assertErrorShape(result);
        assertThat(result.getResponse().getContentAsString()).doesNotContain("connection string leaked");
    }

    @Test
    void answersASaturatedCompilerWith503AndRetryAfter() throws Exception {
        given(compileService.compile(anyString()))
                .willThrow(new CompilerBusyException("at capacity", Duration.ofSeconds(5)));

        assertErrorShape(mockMvc.perform(post("/api/compile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"source\":\"public class A { }\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("compiler-busy"))
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "5"))
                .andReturn());
    }

    private void assertErrorShape(MvcResult result) throws Exception {
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        List<String> fields = new ArrayList<>();
        body.fieldNames().forEachRemaining(fields::add);

        assertThat(fields).containsExactlyInAnyOrder("error", "message");
        assertThat(body.get("error").asText()).isNotBlank();
        assertThat(body.get("message").asText()).isNotBlank();
    }
}
