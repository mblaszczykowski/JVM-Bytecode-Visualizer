package dev.jvmvisualizer.compileservice.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.jvmvisualizer.compileservice.compiler.SourceUnit;
import dev.jvmvisualizer.compileservice.config.CompileProperties;
import dev.jvmvisualizer.compileservice.error.ErrorCode;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.util.unit.DataSize;

class SourceValidatorTest {

    private static final String ADDER = "public class Adder { }";

    @Test
    void returnsTheUnitTheCompilerWillBuild() {
        assertThat(validatorAccepting(64 * 1024).validate(ADDER)).isEqualTo(new SourceUnit("Adder", ADDER));
    }

    @Test
    void rejectsAnEmptySource() {
        assertThatThrownBy(() -> validatorAccepting(64 * 1024).validate("   \n\t "))
                .isInstanceOfSatisfying(InvalidSourceException.class,
                        e -> assertThat(e.error()).isEqualTo(ErrorCode.EMPTY_SOURCE))
                .hasMessage("source must not be empty");

        assertThatThrownBy(() -> validatorAccepting(64 * 1024).validate(null))
                .isInstanceOf(InvalidSourceException.class);
    }

    @Test
    void rejectsASourceWithoutAPublicTopLevelClass() {
        assertThatThrownBy(() -> validatorAccepting(64 * 1024).validate("class Hidden { }"))
                .isInstanceOfSatisfying(InvalidSourceException.class,
                        e -> assertThat(e.error()).isEqualTo(ErrorCode.NO_PUBLIC_CLASS));
    }

    @Test
    void measuresTheSourceInUtf8BytesRatherThanCharacters() {
        String source = ADDER + " // €𝄞";

        assertThatThrownBy(() -> validatorAccepting(32).validate(source))
                .isInstanceOfSatisfying(InvalidSourceException.class,
                        e -> assertThat(e.error()).isEqualTo(ErrorCode.SOURCE_TOO_LARGE))
                .hasMessage("source is 33 bytes, the limit is 32 bytes");
    }

    @Test
    void countsAnUnpairedSurrogateAsThreeBytes() {
        assertThatThrownBy(() -> validatorAccepting(24).validate(ADDER + " //\ud834"))
                .hasMessage("source is 28 bytes, the limit is 24 bytes");
    }

    private static SourceValidator validatorAccepting(int maxSourceBytes) {
        return new SourceValidator(new CompileProperties("http://localhost:5173", DataSize.ofBytes(maxSourceBytes),
                DataSize.ofKilobytes(256), Duration.ofSeconds(10), 2,
                new CompileProperties.RateLimit(10, false, 0)));
    }
}
