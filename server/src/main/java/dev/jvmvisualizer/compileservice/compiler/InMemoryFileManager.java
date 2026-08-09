package dev.jvmvisualizer.compileservice.compiler;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import javax.tools.FileObject;
import javax.tools.ForwardingJavaFileManager;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;

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

    @Override
    public FileObject getFileForOutput(Location location, String packageName, String relativeName,
                                       FileObject sibling) throws IOException {
        throw new IOException("this compile service emits class files only, and only in memory");
    }

    @Override
    public ClassLoader getClassLoader(Location location) {
        return null;
    }

    Map<String, byte[]> classFiles() {
        return classFiles.entrySet().stream()
                .collect(Collectors.toMap(Map.Entry::getKey, entry -> entry.getValue().toByteArray(),
                        (first, second) -> second, LinkedHashMap::new));
    }
}
