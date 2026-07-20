package dev.jvmvisualizer.compileservice.compiler;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import javax.tools.FileObject;
import javax.tools.ForwardingJavaFileManager;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;

/**
 * Captures every output javac produces in memory, so a compilation never touches the filesystem.
 * Reads (platform classes for {@code --release}) still go through the delegate.
 */
final class InMemoryFileManager extends ForwardingJavaFileManager<StandardJavaFileManager> {

    private final Map<String, InMemoryClassFile> classFiles = new LinkedHashMap<>();

    InMemoryFileManager(StandardJavaFileManager delegate) {
        super(delegate);
    }

    @Override
    public JavaFileObject getJavaFileForOutput(Location location, String className, JavaFileObject.Kind kind,
                                               FileObject sibling) {
        InMemoryClassFile classFile = new InMemoryClassFile(className);
        classFiles.put(className, classFile);
        return classFile;
    }

    /**
     * Defence in depth for the non-class outputs: {@code -s}, {@code -h} and any {@code Filer}
     * resource would otherwise be written relative to the working directory. Nothing should ask
     * for one with {@code -proc:none}, and if something does it fails loudly instead of quietly
     * writing a file.
     */
    @Override
    public FileObject getFileForOutput(Location location, String packageName, String relativeName,
                                       FileObject sibling) throws IOException {
        throw new IOException("this compile service emits class files only, and only in memory");
    }

    /**
     * No class loader is ever handed out — the service compiles, it never runs what it compiled.
     * With annotation processing off nothing asks for one, but the null keeps that guarantee local
     * to this class instead of relying on the compiler options alone.
     */
    @Override
    public ClassLoader getClassLoader(Location location) {
        return null;
    }

    /** Binary name to class bytes, in the order javac emitted them. */
    Map<String, byte[]> classFiles() {
        return classFiles.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, entry -> entry.getValue().toByteArray(),
                        (first, second) -> second, LinkedHashMap::new));
    }
}
