package dev.jvmvisualizer.compileservice.compiler;

import java.util.Optional;
import java.util.Set;

public final class SourceNames {

    private static final Set<String> MODIFIERS =
            Set.of("abstract", "final", "static", "strictfp", "sealed", "non-sealed");
    private static final Set<String> TYPE_KEYWORDS = Set.of("class", "interface", "enum", "record");

    private static final String NON_SEALED_TAIL = "-sealed";

    private SourceNames() {
    }

    public static Optional<String> publicTypeName(String source) {
        if (source == null) {
            return Optional.empty();
        }

        int depth = 0;
        boolean sawPublic = false;
        boolean expectName = false;
        int index = 0;

        while (index < source.length()) {
            char current = source.charAt(index);

            if (current == '/' && next(source, index) == '/') {
                index = skipLineComment(source, index);
                continue;
            }
            if (current == '/' && next(source, index) == '*') {
                index = skipBlockComment(source, index);
                continue;
            }
            if (current == '"') {
                index = skipTextOrString(source, index);
                sawPublic = false;
                expectName = false;
                continue;
            }
            if (current == '\'') {
                index = skipCharLiteral(source, index);
                continue;
            }

            if (Character.isJavaIdentifierStart(current)) {
                int end = endOfWord(source, index);
                String word = source.substring(index, end);
                if (word.equals("non") && source.startsWith(NON_SEALED_TAIL, end)) {
                    word = "non-sealed";
                    end += NON_SEALED_TAIL.length();
                }
                index = end;

                if (depth > 0) {
                    continue;
                }
                if (expectName) {
                    return Optional.of(word);
                }
                if (word.equals("public")) {
                    sawPublic = true;
                } else if (sawPublic && TYPE_KEYWORDS.contains(word)) {
                    expectName = true;
                } else if (!MODIFIERS.contains(word)) {
                    sawPublic = false;
                }
                continue;
            }

            switch (current) {
                case '{' -> depth++;
                case '}' -> depth = Math.max(0, depth - 1);
                case ';' -> {
                    sawPublic = false;
                    expectName = false;
                }
                default -> {
                }
            }
            index++;
        }
        return Optional.empty();
    }

    private static char next(String source, int index) {
        return index + 1 < source.length() ? source.charAt(index + 1) : '\0';
    }

    private static int endOfWord(String source, int start) {
        int index = start + 1;
        while (index < source.length() && Character.isJavaIdentifierPart(source.charAt(index))) {
            index++;
        }
        return index;
    }

    private static int skipLineComment(String source, int start) {
        int end = source.indexOf('\n', start);
        return end < 0 ? source.length() : end + 1;
    }

    private static int skipBlockComment(String source, int start) {
        int end = source.indexOf("*/", start + 2);
        return end < 0 ? source.length() : end + 2;
    }

    private static int skipTextOrString(String source, int start) {
        if (source.startsWith("\"\"\"", start)) {
            int end = source.indexOf("\"\"\"", start + 3);
            return end < 0 ? source.length() : end + 3;
        }
        return skipQuoted(source, start, '"');
    }

    private static int skipCharLiteral(String source, int start) {
        return skipQuoted(source, start, '\'');
    }

    private static int skipQuoted(String source, int start, char quote) {
        int index = start + 1;
        while (index < source.length()) {
            char current = source.charAt(index);
            if (current == '\\') {
                index += 2;
                continue;
            }
            if (current == quote || current == '\n') {
                return index + 1;
            }
            index++;
        }
        return source.length();
    }
}
