package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

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
}
