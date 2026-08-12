package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class CompilationResultTest {

    private static final byte[] CLASS_BYTES = {(byte) 0xCA, (byte) 0xFE, (byte) 0xBA, (byte) 0xBE};

    @Test
    void copiesTheClassBytesOnTheWayIn() {
        byte[] mutable = CLASS_BYTES.clone();
        CompilationResult.Success success = new CompilationResult.Success("Adder", mutable, List.of());

        mutable[0] = 0;

        assertThat(success.classBytes()).isEqualTo(CLASS_BYTES);
    }

    @Test
    void copiesTheClassBytesOnTheWayOut() {
        CompilationResult.Success success = new CompilationResult.Success("Adder", CLASS_BYTES, List.of());

        success.classBytes()[0] = 0;

        assertThat(success.classBytes()).isEqualTo(CLASS_BYTES);
    }

    @Test
    void comparesByValueRatherThanIdentity() {
        CompilationResult.Success one = new CompilationResult.Success("Adder", CLASS_BYTES, List.of());
        CompilationResult.Success same = new CompilationResult.Success("Adder", CLASS_BYTES.clone(), List.of());
        CompilationResult.Success other = new CompilationResult.Success("Adder", new byte[] {1}, List.of());

        assertThat(one).isEqualTo(same).hasSameHashCodeAs(same);
        assertThat(one).isNotEqualTo(other).isNotEqualTo("Adder");
    }

    @Test
    void describesItselfWithoutDumpingTheClassFile() {
        CompilationResult.Success success = new CompilationResult.Success("Adder", CLASS_BYTES, List.of());

        assertThat(success).hasToString("Success[className=Adder, classBytes=4 bytes, diagnostics=[]]");
    }

    @Test
    void rejectsAResultWithoutAClassName() {
        assertThatThrownBy(() -> new CompilationResult.Success(null, CLASS_BYTES, List.of()))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> new CompilationResult.Success("Adder", null, List.of()))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    void holdsAnUnmodifiableDiagnosticList() {
        List<CompilerDiagnostic> mutable = new ArrayList<>(List.of(CompilerDiagnostic.error("first")));

        CompilationResult.Success success = new CompilationResult.Success("Adder", CLASS_BYTES, mutable);
        CompilationResult.Failure failure = new CompilationResult.Failure(mutable);
        mutable.add(CompilerDiagnostic.error("second"));

        assertThat(success.diagnostics()).hasSize(1);
        assertThat(failure.diagnostics()).hasSize(1);
    }
}
