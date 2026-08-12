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
import dev.jvmvisualizer.compileservice.compiler.CompilerUnavailableException;
import dev.jvmvisualizer.compileservice.compiler.ForkedCompiler;
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

        ContractFixtures.record(ContractFixtures.Case.INTERNAL_ERROR, result);
        assertErrorShape(result);
        assertThat(result.getResponse().getContentAsString()).doesNotContain("connection string leaked");
    }

    @Test
    void answersASaturatedCompilerWith503AndRetryAfter() throws Exception {
        given(compileService.compile(anyString()))
                .willThrow(new CompilerBusyException(ForkedCompiler.BUSY_MESSAGE, ForkedCompiler.RETRY_AFTER));

        MvcResult result = mockMvc.perform(post("/api/compile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"source\":\"public class A { }\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("compiler-busy"))
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "5"))
                .andReturn();

        ContractFixtures.record(ContractFixtures.Case.COMPILER_BUSY, result);
        assertErrorShape(result);
    }

    @Test
    void answersACompilerThatCouldNotBeRunWith503AndRetryAfter() throws Exception {
        given(compileService.compile(anyString()))
                .willThrow(new CompilerUnavailableException(ForkedCompiler.UNAVAILABLE_MESSAGE,
                        ForkedCompiler.RETRY_AFTER));

        MvcResult result = mockMvc.perform(post("/api/compile")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"source\":\"public class A { }\"}"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("compiler-unavailable"))
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "5"))
                .andReturn();

        ContractFixtures.record(ContractFixtures.Case.COMPILER_UNAVAILABLE, result);
        assertErrorShape(result);
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
