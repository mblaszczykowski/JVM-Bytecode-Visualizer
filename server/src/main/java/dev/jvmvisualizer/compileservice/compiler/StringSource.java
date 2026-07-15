package dev.jvmvisualizer.compileservice.compiler;

import java.net.URI;
import javax.tools.SimpleJavaFileObject;

/** Compilation unit backed by a string; the URI is never opened. */
final class StringSource extends SimpleJavaFileObject {

    private final String code;

    StringSource(String typeName, String code) {
        super(URI.create("string:///" + typeName + Kind.SOURCE.extension), Kind.SOURCE);
        this.code = code;
    }

    @Override
    public CharSequence getCharContent(boolean ignoreEncodingErrors) {
        return code;
    }
}
