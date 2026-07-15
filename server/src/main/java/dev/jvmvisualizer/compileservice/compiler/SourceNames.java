package dev.jvmvisualizer.compileservice.compiler;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Locates the public top-level type declared in a source string.
 *
 * <p>javac rejects a public type whose compilation unit is not named after it, so the in-memory
 * source file object has to carry that name. The pattern is a cheap boundary guard, not a Java
 * parser — javac stays the authority on whether the source is valid.
 */
public final class SourceNames {

    private static final Pattern PUBLIC_TYPE = Pattern.compile(
            "\\bpublic\\s+(?:(?:abstract|final|static|strictfp|sealed|non-sealed)\\s+)*"
                    + "(?:class|interface|enum|record)\\s+([A-Za-z_$][A-Za-z0-9_$]*)");

    private SourceNames() {
    }

    public static Optional<String> publicTypeName(String source) {
        if (source == null) {
            return Optional.empty();
        }
        Matcher matcher = PUBLIC_TYPE.matcher(source);
        return matcher.find() ? Optional.of(matcher.group(1)) : Optional.empty();
    }
}
