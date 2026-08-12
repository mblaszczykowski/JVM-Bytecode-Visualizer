package dev.jvmvisualizer.compileservice.compiler;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;

public final class FloodedCompileRun {

    private static final String NO_CLASS = "no class";

    private static final Duration TIMEOUT = Duration.ofSeconds(20);

    private static final List<String> CHILD_LOGS_EVERY_CLASS_IT_LOADS =
            List.of("-Xlog:class+load=info:stderr:none");

    private static final String ADDER = "public class Adder { static int add(int a, int b) { return a + b; } }";

    private FloodedCompileRun() {
    }

    public static void main(String[] args) {
        PrintStream result = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));

        try (ForkedCompiler compiler = new ForkedCompiler(TIMEOUT, 1, CHILD_LOGS_EVERY_CLASS_IT_LOADS)) {
            CompilationResult compiled = compiler.compile(new SourceUnit("Adder", ADDER));
            result.println(compiled instanceof CompilationResult.Success success ? success.className() : NO_CLASS);
        }
    }
}
