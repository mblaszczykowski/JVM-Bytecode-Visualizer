package dev.jvmvisualizer.compileservice.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

/** Contract tests for {@code POST /api/compile}: status codes and the exact JSON shape. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "compile.rate-limit.requests-per-minute=1000")
class CompileApiTest {

    private static final int CLASS_FILE_MAGIC = 0xCAFEBABE;
    private static final short JAVA_21_MAJOR_VERSION = 65;

    private static final String ADDER = """
            public class Adder {
                public static void main(String[] args) {
                    int sum = add(2, 3);
                }

                static int add(int a, int b) {
                    return a + b;
                }
            }
            """;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void compilesValidSourceAndReturnsTheContractShape() throws Exception {
        MvcResult result = compile(ADDER)
                .andExpect(status().isOk())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.className").value("Adder"))
                .andExpect(jsonPath("$.classFileBase64").isNotEmpty())
                .andExpect(jsonPath("$.diagnostics").isEmpty())
                .andReturn();

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        assertThat(fieldNames(body)).containsExactlyInAnyOrder("success", "className", "classFileBase64", "diagnostics");

        ByteBuffer classFile = ByteBuffer.wrap(Base64.getDecoder().decode(body.get("classFileBase64").asText()));
        assertThat(classFile.getInt()).isEqualTo(CLASS_FILE_MAGIC);
        classFile.getShort(); // minor version
        assertThat(classFile.getShort()).isEqualTo(JAVA_21_MAJOR_VERSION);
    }

    @Test
    void returnsDiagnosticsInsteadOfBytesWhenTheSourceDoesNotCompile() throws Exception {
        String broken = """
                public class Broken {
                    static int value() {
                        return 1
                    }
                }
                """;

        MvcResult result = compile(broken)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.className").doesNotExist())
                .andExpect(jsonPath("$.classFileBase64").doesNotExist())
                .andExpect(jsonPath("$.diagnostics[0].kind").value("ERROR"))
                .andExpect(jsonPath("$.diagnostics[0].line").value(3))
                .andExpect(jsonPath("$.diagnostics[0].column").isNumber())
                .andExpect(jsonPath("$.diagnostics[0].message").isNotEmpty())
                .andReturn();

        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        // null className / classFileBase64 stay in the payload; jsonPath treats null as "does not exist"
        assertThat(fieldNames(body)).containsExactlyInAnyOrder("success", "className", "classFileBase64", "diagnostics");
        assertThat(body.get("className").isNull()).isTrue();
        assertThat(body.get("classFileBase64").isNull()).isTrue();
        assertThat(fieldNames(body.get("diagnostics").get(0)))
                .containsExactlyInAnyOrder("line", "column", "kind", "message");
    }

    @Test
    void reportsSourcesThatWouldProduceMoreThanOneClassFile() throws Exception {
        String withNestedClass = """
                public class Outer {
                    public static void main(String[] args) {
                        int value = Inner.value();
                    }

                    static class Inner {
                        static int value() {
                            return 1;
                        }
                    }
                }
                """;

        compile(withNestedClass)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.classFileBase64").doesNotExist())
                .andExpect(jsonPath("$.diagnostics[0].kind").value("ERROR"))
                .andExpect(jsonPath("$.diagnostics[0].message",
                        containsString("single top-level class")));
    }

    @Test
    void rejectsEmptySource() throws Exception {
        compile("")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").isNotEmpty())
                .andExpect(jsonPath("$.message", containsString("source")));
    }

    @Test
    void rejectsRequestWithoutSourceField() throws Exception {
        mockMvc.perform(post("/api/compile").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("invalid-request"));
    }

    @Test
    void rejectsSourceLargerThan64KiB() throws Exception {
        String oversized = "public class Big {}\n// " + "x".repeat(70_000);

        compile(oversized)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("source-too-large"))
                .andExpect(jsonPath("$.message", containsString("65536")));
    }

    @Test
    void rejectsSourceWithoutAPublicClass() throws Exception {
        compile("class PackagePrivate { }")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("no-public-class"));
    }

    /**
     * A megabyte-scale body used to be parsed into the heap in full and measured afterwards, so a
     * 19 MB {@code source} — comfortably inside Jackson's own limits — was an out-of-memory exit
     * for one request. The filter answers from Content-Length alone, before anything is read.
     */
    @Test
    void refusesAnOversizedBodyBeforeReadingIt() throws Exception {
        byte[] body = ("{\"source\":\"" + "x".repeat(2_000_000) + "\"}").getBytes(StandardCharsets.UTF_8);

        long start = System.nanoTime();
        mockMvc.perform(post("/api/compile").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("source-too-large"))
                .andExpect(jsonPath("$.message", containsString("request body")));

        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(2));
    }

    /** Second line: a body under the request cap whose one string is still far too long. */
    @Test
    void refusesASourceFieldLongerThanJacksonMayMaterialize() throws Exception {
        compile("x".repeat(100_000))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("source-too-large"));
    }

    /**
     * The name scan used to be a regular expression whose modifier group recursed once per
     * repetition: this source raised {@link StackOverflowError} out of the controller, past the
     * advice, and the client got a 500 with no JSON body at all.
     */
    @Test
    void answersTheModifierPayloadWithDiagnosticsRatherThanA500() throws Exception {
        String pathological = "public " + "final ".repeat(3_000) + "class Pathological { }";

        compile(pathological)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.diagnostics").isNotEmpty());
    }

    @Test
    void answersCorsPreflightForTheConfiguredOrigin() throws Exception {
        mockMvc.perform(options("/api/compile")
                        .header(HttpHeaders.ORIGIN, "http://localhost:5173")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5173"));
    }

    @Test
    void rejectsCorsRequestFromAnotherOrigin() throws Exception {
        mockMvc.perform(options("/api/compile")
                        .header(HttpHeaders.ORIGIN, "https://evil.example")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isForbidden());
    }

    private ResultActions compile(String source) throws Exception {
        ObjectNode request = objectMapper.createObjectNode().put("source", source);
        return mockMvc.perform(post("/api/compile")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsBytes(request)));
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.fieldNames().forEachRemaining(names::add);
        return names;
    }
}
