package dev.jvmvisualizer.compileservice.compiler;

/** Turns one source string into one class file, or into the diagnostics explaining why not. */
public interface SourceCompiler {

    CompilationResult compile(String source);
}
