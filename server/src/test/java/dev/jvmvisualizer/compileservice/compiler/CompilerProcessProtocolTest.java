package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import javax.tools.Diagnostic;
import org.junit.jupiter.api.Test;

class CompilerProcessProtocolTest {

    private static final byte[] CLASS_BYTES = {(byte) 0xCA, (byte) 0xFE, (byte) 0xBA, (byte) 0xBE};

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void carriesASourceUnitToTheChildAndBack() throws Exception {
        SourceUnit unit = new SourceUnit("Adder", "public class Adder { }");

        byte[] wire = objectMapper.writeValueAsBytes(CompilerProcessProtocol.Request.of(unit));

        assertThat(objectMapper.readValue(wire, CompilerProcessProtocol.Request.class).toUnit()).isEqualTo(unit);
    }

    @Test
    void carriesASuccessBackToTheParent() throws Exception {
        CompilationResult.Success success = new CompilationResult.Success("Adder", CLASS_BYTES,
                List.of(new CompilerDiagnostic(Diagnostic.Kind.WARNING, 3, 7, "unchecked call")));

        assertThat(roundTrip(success)).isEqualTo(success);
    }

    @Test
    void carriesAFailureBackToTheParent() throws Exception {
        CompilationResult.Failure failure = CompilationResult.Failure.of("compilation timed out");

        assertThat(roundTrip(failure)).isEqualTo(failure);
    }

    @Test
    void readsAResultWithoutPositionsOrAKnownKind() throws Exception {
        byte[] wire = """
                {"success":false,"diagnostics":[{"kind":"NONSENSE","line":null,"column":null,"message":null}]}
                """.getBytes();

        CompilationResult result = objectMapper.readValue(wire, CompilerProcessProtocol.Payload.class).toResult();

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).singleElement().satisfies(diagnostic -> {
            assertThat(diagnostic.kind()).isEqualTo(Diagnostic.Kind.OTHER);
            assertThat(diagnostic.line()).isNull();
            assertThat(diagnostic.message()).isEmpty();
        });
    }

    @Test
    void treatsASuccessWithoutClassBytesAsAFailure() throws Exception {
        byte[] wire = "{\"success\":true,\"className\":\"Adder\"}".getBytes();

        CompilationResult result = objectMapper.readValue(wire, CompilerProcessProtocol.Payload.class).toResult();

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).isEmpty();
    }

    private CompilationResult roundTrip(CompilationResult result) throws Exception {
        byte[] wire = objectMapper.writeValueAsBytes(CompilerProcessProtocol.Payload.of(result));
        return objectMapper.readValue(wire, CompilerProcessProtocol.Payload.class).toResult();
    }
}
