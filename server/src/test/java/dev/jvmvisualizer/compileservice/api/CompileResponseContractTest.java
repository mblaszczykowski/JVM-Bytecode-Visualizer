package dev.jvmvisualizer.compileservice.api;

import static org.junit.jupiter.api.Assumptions.assumeFalse;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import dev.jvmvisualizer.compileservice.compiler.CompilationResult;
import dev.jvmvisualizer.compileservice.compiler.CompilerDiagnostic;
import dev.jvmvisualizer.compileservice.service.CompileService;
import java.util.List;
import javax.tools.Diagnostic;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "compile.rate-limit.requests-per-minute=1000")
class CompileResponseContractTest {

    private static final byte[] CLASS_FILE = {(byte) 0xCA, (byte) 0xFE, (byte) 0xBA, (byte) 0xBE};

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private CompileService compileService;

    @Test
    void recordsACompiledClass() throws Exception {
        given(compileService.compile(anyString())).willReturn(new CompilationResult.Success("Adder", CLASS_FILE,
                List.of(new CompilerDiagnostic(Diagnostic.Kind.WARNING, 5, 9, "unchecked call to add(int,int)"))));

        ContractFixtures.record(ContractFixtures.Case.COMPILE_SUCCESS, compile()
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andReturn());
    }

    @Test
    void recordsDiagnosticsWithoutAClass() throws Exception {
        given(compileService.compile(anyString())).willReturn(new CompilationResult.Failure(List.of(
                new CompilerDiagnostic(Diagnostic.Kind.ERROR, 3, 16, "';' expected"),
                new CompilerDiagnostic(Diagnostic.Kind.NOTE, null, null,
                        "some input files use unchecked or unsafe operations"))));

        ContractFixtures.record(ContractFixtures.Case.COMPILE_DIAGNOSTICS, compile()
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andReturn());
    }

    @Test
    void committedFixturesCoverEveryCaseAndNothingElse() throws Exception {
        assumeFalse(ContractFixtures.updating());

        ContractFixtures.assertNothingElseIsCommitted();
    }

    private ResultActions compile() throws Exception {
        return mockMvc.perform(post("/api/compile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"source\":\"public class Adder { }\"}"));
    }
}
