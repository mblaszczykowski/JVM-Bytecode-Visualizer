package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import javax.tools.Diagnostic;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class InMemoryCompilerTest {

    private static final int CLASS_FILE_MAGIC = 0xCAFEBABE;
    private static final short JAVA_21_MAJOR_VERSION = 65;

    private static final String STATIC_INITIALIZER_PROPERTY = "compile-service.test.static-initializer-ran";

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

    private final InMemoryCompiler compiler = new InMemoryCompiler();

    @BeforeEach
    @AfterEach
    void clearMarker() {
        System.clearProperty(STATIC_INITIALIZER_PROPERTY);
    }

    @Test
    void compilesValidSourceToAJava21ClassFile() {
        CompilationResult result = compiler.compile(new SourceUnit("Adder", ADDER));

        assertThat(result).isInstanceOfSatisfying(CompilationResult.Success.class, success -> {
            assertThat(success.className()).isEqualTo("Adder");
            assertThat(success.diagnostics()).isEmpty();

            ByteBuffer classFile = ByteBuffer.wrap(success.classBytes());
            assertThat(classFile.getInt()).isEqualTo(CLASS_FILE_MAGIC);
            classFile.getShort();
            assertThat(classFile.getShort()).isEqualTo(JAVA_21_MAJOR_VERSION);
        });
    }

    @Test
    void emitsTheDebugTablesTheVisualizerNeeds() {
        CompilationResult result = compiler.compile(new SourceUnit("Adder", ADDER));

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

        CompilationResult result = compiler.compile(new SourceUnit("Broken", broken));

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).anySatisfy(diagnostic -> {
            assertThat(diagnostic.kind()).isEqualTo(Diagnostic.Kind.ERROR);
            assertThat(diagnostic.line()).isEqualTo(3);
            assertThat(diagnostic.column()).isNotNull();
            assertThat(diagnostic.message()).isEqualTo("';' expected");
        });
    }

    @Test
    void reportsDiagnosticsInEnglishWhateverTheHostLocaleIs() {
        Locale host = Locale.getDefault();
        try {
            Locale.setDefault(Locale.JAPAN);
            CompilationResult result =
                    new InMemoryCompiler().compile(new SourceUnit("Missing", "public class Missing { int x = y; }"));

            assertThat(result.diagnostics()).extracting(CompilerDiagnostic::message)
                    .anySatisfy(message -> assertThat(message).startsWith("cannot find symbol"));
        } finally {
            Locale.setDefault(host);
        }
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

        CompilationResult result = compiler.compile(new SourceUnit("Outer", withNestedClass));

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics())
                .extracting(CompilerDiagnostic::message)
                .contains(InMemoryCompiler.MULTIPLE_CLASSES_MESSAGE);
    }

    @Test
    void neverFailsWithoutADiagnostic() {
        assertThat(compiler.compile(new SourceUnit("Nothing", "public class Nothing {")).diagnostics()).isNotEmpty();
        assertThat(compiler.compile(new SourceUnit("Mismatch", "public class Mismatch { }\nclass Second { }\n"))
                .diagnostics()).isNotEmpty();
    }

    @Test
    void cannotSeeTheTypesOnThisServersClassPath() {
        String peeking = """
                import org.springframework.stereotype.Service;

                public class Peeking {
                    static Class<?> service = Service.class;
                }
                """;

        CompilationResult result = compiler.compile(new SourceUnit("Peeking", peeking));

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).extracting(CompilerDiagnostic::message)
                .anyMatch(message -> message.contains("org.springframework"));
    }

    @Test
    void neverRunsWhatItCompiles() {
        String withStaticInitializer = """
                public class Eager {
                    static {
                        System.setProperty("%s", "true");
                    }

                    public static void main(String[] args) {
                    }
                }
                """.formatted(STATIC_INITIALIZER_PROPERTY);

        CompilationResult result = compiler.compile(new SourceUnit("Eager", withStaticInitializer));

        assertThat(result).isInstanceOf(CompilationResult.Success.class);
        assertThat(System.getProperty(STATIC_INITIALIZER_PROPERTY)).isNull();
    }

    @Test
    void pinsTheHardeningOptionsPassedToJavac() {
        assertThat(InMemoryCompiler.options())
                .containsSequence("--release", "21")
                .contains("-proc:none");
    }
}
