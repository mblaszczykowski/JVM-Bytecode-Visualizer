package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import javax.tools.Diagnostic;
import org.junit.jupiter.api.Test;

class InMemoryCompilerTest {

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

    private final InMemoryCompiler compiler = new InMemoryCompiler(Duration.ofSeconds(10));

    @Test
    void compilesValidSourceToAJava21ClassFile() {
        CompilationResult result = compiler.compile(ADDER);

        assertThat(result).isInstanceOfSatisfying(CompilationResult.Success.class, success -> {
            assertThat(success.className()).isEqualTo("Adder");
            assertThat(success.diagnostics()).isEmpty();

            ByteBuffer classFile = ByteBuffer.wrap(success.classBytes());
            assertThat(classFile.getInt()).isEqualTo(CLASS_FILE_MAGIC);
            classFile.getShort(); // minor version
            assertThat(classFile.getShort()).isEqualTo(JAVA_21_MAJOR_VERSION);
        });
    }

    @Test
    void emitsTheDebugTablesTheVisualizerNeeds() {
        CompilationResult result = compiler.compile(ADDER);

        // -g: the UI highlights source lines and names locals, which needs both tables present.
        assertThat(result).isInstanceOfSatisfying(CompilationResult.Success.class, success ->
                assertThat(new String(success.classBytes(), StandardCharsets.ISO_8859_1))
                        .contains("LineNumberTable")
                        .contains("LocalVariableTable"));
    }

    @Test
    void reportsSyntaxErrorsWithPosition() {
        String broken = """
                public class Broken {
                    static int value() {
                        return 1
                    }
                }
                """;

        CompilationResult result = compiler.compile(broken);

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).anySatisfy(diagnostic -> {
            assertThat(diagnostic.kind()).isEqualTo(Diagnostic.Kind.ERROR);
            assertThat(diagnostic.line()).isEqualTo(3);
            assertThat(diagnostic.column()).isNotNull();
            assertThat(diagnostic.message()).isNotBlank();
        });
    }

    @Test
    void rejectsSourcesThatProduceMoreThanOneClassFile() {
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

        CompilationResult result = compiler.compile(withNestedClass);

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics())
                .extracting(CompilerDiagnostic::message)
                .contains(InMemoryCompiler.MULTIPLE_CLASSES_MESSAGE);
    }

    @Test
    void failsWithADiagnosticWhenCompilationExceedsTheTimeout() {
        InMemoryCompiler impatient = new InMemoryCompiler(Duration.ofMillis(1));

        CompilationResult result = impatient.compile(ADDER);

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).singleElement().satisfies(diagnostic -> {
            assertThat(diagnostic.kind()).isEqualTo(Diagnostic.Kind.ERROR);
            assertThat(diagnostic.message()).isEqualTo(InMemoryCompiler.TIMEOUT_MESSAGE);
        });
    }

    @Test
    void pinsTheHardeningOptionsPassedToJavac() {
        assertThat(InMemoryCompiler.options())
                .containsSequence("--release", "21")
                .contains("-proc:none");
    }
}
