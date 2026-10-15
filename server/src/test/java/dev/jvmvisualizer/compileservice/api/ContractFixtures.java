package dev.jvmvisualizer.compileservice.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.core.util.DefaultIndenter;
import tools.jackson.core.util.DefaultPrettyPrinter;
import tools.jackson.core.util.Separators;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.ObjectWriter;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

final class ContractFixtures {

    enum Case {

        COMPILE_SUCCESS("compile-success"),
        COMPILE_DIAGNOSTICS("compile-diagnostics"),
        NO_PUBLIC_CLASS("no-public-class"),
        SOURCE_TOO_LARGE("source-too-large"),
        SOURCE_FIELD_TOO_LONG("source-field-too-long"),
        REQUEST_BODY_TOO_LARGE("request-body-too-large"),
        INVALID_REQUEST("invalid-request"),
        RATE_LIMIT_EXCEEDED("rate-limit-exceeded"),
        COMPILER_BUSY("compiler-busy"),
        COMPILER_UNAVAILABLE("compiler-unavailable"),
        INTERNAL_ERROR("internal-error");

        private final String name;

        Case(String name) {
            this.name = name;
        }

        String fileName() {
            return name + ".json";
        }
    }

    private static final Path COMMITTED = Path.of("src", "test", "resources", "contract");
    private static final Path REGENERATED = Path.of("target", "contract");
    private static final String UPDATE_PROPERTY = "contract.update";

    private static final List<String> RECORDED_HEADERS =
            List.of(HttpHeaders.CONTENT_TYPE, HttpHeaders.RETRY_AFTER);

    private static final ObjectMapper OBJECT_MAPPER = JsonMapper.builder().build();
    private static final ObjectWriter WRITER = OBJECT_MAPPER.writer().with(prettyPrinter());

    private ContractFixtures() {
    }

    static boolean updating() {
        return Boolean.getBoolean(UPDATE_PROPERTY);
    }

    static void record(Case recorded, MvcResult result) throws IOException {
        String regenerated = document(recorded, result.getResponse());

        Files.createDirectories(REGENERATED);
        Path fresh = REGENERATED.resolve(recorded.fileName());
        Files.writeString(fresh, regenerated, StandardCharsets.UTF_8);

        Path committed = COMMITTED.resolve(recorded.fileName());
        if (updating()) {
            Files.createDirectories(COMMITTED);
            Files.writeString(committed, regenerated, StandardCharsets.UTF_8);
            return;
        }

        assertThat(committed).as("%s is not committed yet; this run wrote it to %s", recorded.fileName(), fresh)
                .exists();
        assertThat(Files.readString(committed, StandardCharsets.UTF_8))
                .as("the response no longer matches %s; this run wrote it to %s. Re-run with -D%s=true "
                        + "to accept the new contract, and tell the frontend about it",
                        committed, fresh, UPDATE_PROPERTY)
                .isEqualTo(regenerated);
    }

    static void assertNothingElseIsCommitted() throws IOException {
        try (Stream<Path> committed = Files.list(COMMITTED)) {
            assertThat(committed.map(path -> path.getFileName().toString()))
                    .containsExactlyInAnyOrderElementsOf(
                            Arrays.stream(Case.values()).map(Case::fileName).toList());
        }
    }

    private static String document(Case recorded, MockHttpServletResponse response) throws IOException {
        ObjectNode document = OBJECT_MAPPER.createObjectNode();
        document.put("case", recorded.name);
        document.put("status", response.getStatus());

        ObjectNode headers = document.putObject("headers");
        for (String header : RECORDED_HEADERS) {
            String value = response.getHeader(header);
            if (value != null) {
                headers.put(header, value);
            }
        }

        JsonNode body = OBJECT_MAPPER.readTree(response.getContentAsString(StandardCharsets.UTF_8));
        document.set("body", body);

        return WRITER.writeValueAsString(document) + "\n";
    }

    private static DefaultPrettyPrinter prettyPrinter() {
        DefaultIndenter indenter = new DefaultIndenter("  ", "\n");
        DefaultPrettyPrinter printer = new DefaultPrettyPrinter()
                .withSeparators(Separators.createDefaultInstance().withObjectNameValueSpacing(Separators.Spacing.AFTER));
        printer.indentObjectsWith(indenter);
        printer.indentArraysWith(indenter);
        return printer;
    }
}
