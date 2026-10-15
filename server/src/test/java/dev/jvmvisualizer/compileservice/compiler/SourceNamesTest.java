package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class SourceNamesTest {

    @Test
    void findsThePublicClassName() {
        assertThat(SourceNames.publicTypeName("public class Adder { }")).contains("Adder");
    }

    @Test
    void findsTypesDeclaredWithEveryModifierCombination() {
        assertThat(SourceNames.publicTypeName("public abstract class Shape { }")).contains("Shape");
        assertThat(SourceNames.publicTypeName("public final class Money { }")).contains("Money");
        assertThat(SourceNames.publicTypeName("public sealed interface Node permits Leaf { }")).contains("Node");
        assertThat(SourceNames.publicTypeName("public non-sealed class Leaf extends Node { }")).contains("Leaf");
        assertThat(SourceNames.publicTypeName("public enum Suit { HEARTS }")).contains("Suit");
        assertThat(SourceNames.publicTypeName("public record Point(int x, int y) { }")).contains("Point");
    }

    @Test
    void looksPastThePackageAndImportDeclarations() {
        String source = """
                package dev.example.app;

                import java.util.List;

                public class Registry { }
                """;

        assertThat(SourceNames.publicTypeName(source)).contains("Registry");
    }

    @Test
    void ignoresADeclarationInsideAComment() {
        String source = """
                // public class Commented { }
                /* public class Blocked { } */
                public class Real { }
                """;

        assertThat(SourceNames.publicTypeName(source)).contains("Real");
    }

    @Test
    void ignoresADeclarationInsideAStringLiteral() {
        String source = """
                public class Quoting {
                    static String snippet = "public class Quoted { }";
                }
                """;

        assertThat(SourceNames.publicTypeName(source)).contains("Quoting");
    }

    @Test
    void ignoresADeclarationInsideATextBlockBeforeTheRealOne() {
        String source = "class Helper {\n"
                + "    static String template = \"\"\"\n"
                + "            public class Templated { }\n"
                + "            \"\"\";\n"
                + "}\n"
                + "public class Outer { }\n";

        assertThat(SourceNames.publicTypeName(source)).contains("Outer");
    }

    @Test
    void ignoresADeclarationInsideACharacterOrEscapedLiteral() {
        String source = """
                class Escaping {
                    static char brace = '}';
                    static String quote = "a \\" public class Escaped { } ";
                }
                public class Real { }
                """;

        assertThat(SourceNames.publicTypeName(source)).contains("Real");
    }

    @Test
    void findsNothingInATruncatedSource() {
        assertThat(SourceNames.publicTypeName("public class Open { /* unterminated")).contains("Open");
        assertThat(SourceNames.publicTypeName("class A { String s = \"unterminated")).isEmpty();
        assertThat(SourceNames.publicTypeName("class A { char c = 'u")).isEmpty();
        assertThat(SourceNames.publicTypeName("class A { String s = \"\"\"\n unterminated")).isEmpty();
        assertThat(SourceNames.publicTypeName("} } } public class Recovered { }")).contains("Recovered");
    }

    @Test
    void ignoresPublicMembersOfANonPublicType() {
        String source = """
                class PackagePrivate {
                    public static void main(String[] args) { }
                }
                """;

        assertThat(SourceNames.publicTypeName(source)).isEmpty();
    }

    @Test
    void findsNothingWhenNoTypeIsPublic() {
        assertThat(SourceNames.publicTypeName("class Hidden { }")).isEmpty();
        assertThat(SourceNames.publicTypeName("")).isEmpty();
        assertThat(SourceNames.publicTypeName(null)).isEmpty();
    }

    @Test
    @Timeout(5)
    void survivesThousandsOfModifiers() {
        String pathological = "public " + "final ".repeat(3_000) + "class Pathological { }";

        assertThat(SourceNames.publicTypeName(pathological)).contains("Pathological");
    }

    @Test
    @Timeout(5)
    void staysLinearOnAModifierRunThatNeverReachesAType() {
        String pathological = "public " + "final ".repeat(50_000);

        assertThat(SourceNames.publicTypeName(pathological)).isEmpty();
    }

    @Test
    void scansASixtyFourKibibyteSourceQuickly() {
        String source = "public class Big {\n" + "    // padding\n".repeat(5_000) + "}\n";

        long start = System.nanoTime();
        assertThat(SourceNames.publicTypeName(source)).contains("Big");
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(1));
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "public class Plain { }",
        "public @Deprecated class Annotated { }",
        "public @SuppressWarnings(\"all\") final class Suppressed { }",
        "public @java.lang.Deprecated class Qualified { }",
        "@Deprecated public class AnnotationFirst { }",
        "public @interface Marker { }",
        "public @Deprecated record Annotated(int a) { }",
        "public abstract class Shape { }",
        "public enum Suit { HEARTS }",
        "// comment\rpublic class CarriageReturn { }",
        "public @SuppressWarnings(/* ( */ \"all\") class CommentedAnnotation { }",
        "public @java /* trivia */ . lang.Deprecated class CommentedQualified { }",
        "public @ /* trivia */ interface CommentedMarker { }",
        "public class \ud801\udc00 { }",
        "public class Name\ud801\udc00 { }",
        "p\\u0075blic cl\\uuuu0061ss Escaped { }",
        "public class Escaped\\u004eame { }",
        "// comment\\u000dpublic class EscapedNewline { }",
    })
    void agreesWithJavacOnWhichTypeAFileDeclares(String source) {
        String name = SourceNames.publicTypeName(source).orElseThrow();

        CompilationResult result = new InMemoryCompiler().compile(new SourceUnit(name, source));

        assertThat(result)
                .as("javac must accept %s and emit exactly the type SourceNames named", name)
                .isInstanceOfSatisfying(CompilationResult.Success.class,
                        success -> assertThat(success.className()).isEqualTo(name));
    }

    @Test
    void keepsScanningPastAnAnnotationThatCarriesArguments() {
        assertThat(SourceNames.publicTypeName("public @A(v = f(1, (2))) class Nested { }"))
                .contains("Nested");
        assertThat(SourceNames.publicTypeName("public @A(\"(\") class Parenthesis { }"))
                .contains("Parenthesis");
    }

    @Test
    void ignoresDelimitersInsideCommentsInAnnotationArguments() {
        assertThat(SourceNames.publicTypeName("public @A(/* ) */ \"x\") class BlockComment { }"))
                .contains("BlockComment");
        assertThat(SourceNames.publicTypeName("public @A(// )\r\"x\") class LineComment { }"))
                .contains("LineComment");
    }

    @Test
    void ignoresAnEscapedTextBlockDelimiterBeforeThePublicClass() {
        String source = "class Hidden { String text = \"\"\"\n\\\"\"\" } public class Fake {}\n\"\"\"; }"
                + " public class Real { }";

        assertThat(SourceNames.publicTypeName(source)).contains("Real");
    }

    @Test
    void unicodeEscapeEligibilityAgreesWithJavac() {
        List<String> escapedLiterals = List.of("\\\\u0022", "\\u005c\\u005c", "\\\\\\u005a");
        for (String literal : escapedLiterals) {
            String source = "@SuppressWarnings(\"" + literal + "\") public class Actual { }";
            assertThat(SourceNames.publicTypeName(source)).contains("Actual");
            assertThat(new InMemoryCompiler().compile(new SourceUnit("Actual", source)))
                    .isInstanceOf(CompilationResult.Success.class);
        }
    }
}
