package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.function.Supplier;
import javax.annotation.processing.Processor;
import javax.tools.Diagnostic;
import javax.tools.JavaCompiler;
import javax.tools.StandardJavaFileManager;
import javax.tools.StandardLocation;
import javax.tools.ToolProvider;
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
    void reportsACompilationThatSucceededWithoutEmittingAClassFile() {
        CompilationResult result = compiler.compile(new SourceUnit("Empty", "// no type is declared here\n"));

        assertThat(result).isInstanceOf(CompilationResult.Failure.class);
        assertThat(result.diagnostics()).extracting(CompilerDiagnostic::message)
                .contains(InMemoryCompiler.NO_OUTPUT_MESSAGE);
    }

    @Test
    void treatsAnythingJavacThrowsAsAFailedCompilation() {
        assertThat(compiler.call(javacThat(() -> {
            throw new OutOfMemoryError("Java heap space");
        }))).isFalse();
        assertThat(compiler.call(javacThat(() -> {
            throw new StackOverflowError();
        }))).isFalse();
        assertThat(compiler.call(javacThat(() -> {
            throw new IllegalStateException("javac gave up");
        }))).isFalse();
    }

    @Test
    void refusesToWriteAnyFileOtherThanAClassFile() throws IOException {
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();

        try (StandardJavaFileManager standard = javac.getStandardFileManager(null, null, StandardCharsets.UTF_8);
             InMemoryFileManager fileManager = new InMemoryFileManager(standard)) {

            assertThatThrownBy(() -> fileManager.getFileForOutput(StandardLocation.SOURCE_OUTPUT, "", "Adder.java",
                    null))
                    .isInstanceOf(IOException.class)
                    .hasMessageContaining("class files only");
        }
    }

    @Test
    void pinsTheHardeningOptionsPassedToJavac() {
        assertThat(InMemoryCompiler.options())
                .containsSequence("--release", "21")
                .contains("-proc:none");
    }

    private static JavaCompiler.CompilationTask javacThat(Supplier<Boolean> outcome) {
        return new JavaCompiler.CompilationTask() {

            @Override
            public void addModules(Iterable<String> moduleNames) {
                throw new UnsupportedOperationException();
            }

            @Override
            public void setProcessors(Iterable<? extends Processor> processors) {
                throw new UnsupportedOperationException();
            }

            @Override
            public void setLocale(Locale locale) {
                throw new UnsupportedOperationException();
            }

            @Override
            public Boolean call() {
                return outcome.get();
            }
        };
    }
}
