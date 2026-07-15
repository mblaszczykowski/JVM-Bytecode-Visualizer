package dev.jvmvisualizer.compileservice.compiler;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.net.URI;
import javax.tools.SimpleJavaFileObject;

/** Output file object that keeps javac's bytes in a buffer instead of on disk. */
final class InMemoryClassFile extends SimpleJavaFileObject {

    private final ByteArrayOutputStream bytes = new ByteArrayOutputStream();

    InMemoryClassFile(String className) {
        super(URI.create("memory:///" + className.replace('.', '/') + Kind.CLASS.extension), Kind.CLASS);
    }

    @Override
    public OutputStream openOutputStream() {
        return bytes;
    }

    byte[] toByteArray() {
        return bytes.toByteArray();
    }
}
