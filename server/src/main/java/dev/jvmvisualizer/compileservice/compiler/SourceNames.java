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
        source = translateUnicodeEscapes(source);

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
            if (current == '@' && !declaresAnnotationType(source, index)) {
                index = skipAnnotation(source, index);
                continue;
            }

            if (Character.isJavaIdentifierStart(source.codePointAt(index))) {
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

    private static boolean declaresAnnotationType(String source, int at) {
        int start = skipWhitespace(source, at + 1);
        return start < source.length()
                && Character.isJavaIdentifierStart(source.codePointAt(start))
                && source.substring(start, endOfWord(source, start)).equals("interface");
    }

    private static int skipAnnotation(String source, int at) {
        int index = skipWhitespace(source, at + 1);
        if (index >= source.length() || !Character.isJavaIdentifierStart(source.codePointAt(index))) {
            return at + 1;
        }
        index = endOfWord(source, index);

        int dot = skipWhitespace(source, index);
        while (dot < source.length() && source.charAt(dot) == '.') {
            int name = skipWhitespace(source, dot + 1);
            if (name >= source.length() || !Character.isJavaIdentifierStart(source.codePointAt(name))) {
                return index;
            }
            index = endOfWord(source, name);
            dot = skipWhitespace(source, index);
        }

        return dot < source.length() && source.charAt(dot) == '(' ? skipArguments(source, dot) : index;
    }

    private static int skipArguments(String source, int open) {
        int index = open + 1;
        int depth = 1;
        while (index < source.length() && depth > 0) {
            char current = source.charAt(index);
            if (current == '/' && next(source, index) == '/') {
                index = skipLineComment(source, index);
            } else if (current == '/' && next(source, index) == '*') {
                index = skipBlockComment(source, index);
            } else if (current == '"') {
                index = skipTextOrString(source, index);
            } else if (current == '\'') {
                index = skipCharLiteral(source, index);
            } else {
                if (current == '(') {
                    depth++;
                } else if (current == ')') {
                    depth--;
                }
                index++;
            }
        }
        return index;
    }

    private static int skipWhitespace(String source, int start) {
        int index = start;
        while (index < source.length()) {
            if (Character.isWhitespace(source.charAt(index))) {
                index++;
            } else if (source.startsWith("/*", index)) {
                index = skipBlockComment(source, index);
            } else if (source.startsWith("//", index)) {
                index = skipLineComment(source, index);
            } else {
                break;
            }
        }
        return index;
    }

    private static int endOfWord(String source, int start) {
        int index = start + Character.charCount(source.codePointAt(start));
        while (index < source.length() && Character.isJavaIdentifierPart(source.codePointAt(index))) {
            index += Character.charCount(source.codePointAt(index));
        }
        return index;
    }

    private static int skipLineComment(String source, int start) {
        int index = start + 2;
        while (index < source.length() && source.charAt(index) != '\n' && source.charAt(index) != '\r') {
            index++;
        }
        return index;
    }

    private static int skipBlockComment(String source, int start) {
        int end = source.indexOf("*/", start + 2);
        return end < 0 ? source.length() : end + 2;
    }

    private static int skipTextOrString(String source, int start) {
        if (source.startsWith("\"\"\"", start)) {
            int index = start + 3;
            while (index < source.length()) {
                if (source.charAt(index) == '\\') {
                    index += 2;
                } else if (source.startsWith("\"\"\"", index)) {
                    return index + 3;
                } else {
                    index++;
                }
            }
            return source.length();
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
            if (current == quote || current == '\n' || current == '\r') {
                return index + 1;
            }
            index++;
        }
        return source.length();
    }

    private static String translateUnicodeEscapes(String source) {
        StringBuilder translated = new StringBuilder(source.length());
        int backslashes = 0;
        boolean escaped = false;
        for (int index = 0; index < source.length(); index++) {
            char current = source.charAt(index);
            boolean unicodeEscape = false;
            if (current == '\\' && (escaped || backslashes % 2 == 0)) {
                int digits = index + 1;
                while (digits < source.length() && source.charAt(digits) == 'u') {
                    digits++;
                }
                if (digits > index + 1 && digits + 4 <= source.length()) {
                    int value = 0;
                    for (int digit = 0; digit < 4; digit++) {
                        int hex = Character.digit(source.charAt(digits + digit), 16);
                        if (hex < 0 || source.charAt(digits + digit) > 127) {
                            value = -1;
                            break;
                        }
                        value = value * 16 + hex;
                    }
                    if (value >= 0) {
                        current = (char) value;
                        index = digits + 3;
                        unicodeEscape = true;
                    }
                }
            }
            translated.append(current);
            backslashes = current == '\\' ? backslashes + 1 : 0;
            escaped = unicodeEscape;
        }
        return translated.toString();
    }
}
