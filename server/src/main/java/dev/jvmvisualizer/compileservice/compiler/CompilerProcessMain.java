package dev.jvmvisualizer.compileservice.compiler;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

public final class CompilerProcessMain {

    private CompilerProcessMain() {
    }

    public static void main(String[] args) {
        PrintStream protocol = new PrintStream(new FileOutputStream(FileDescriptor.out), false, StandardCharsets.UTF_8);
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));

        int status = 0;
        try {
            String source = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
            CompilationResult result = new InMemoryCompiler().compile(source);
            protocol.write(new ObjectMapper().writeValueAsBytes(CompilerProcessProtocol.Payload.of(result)));
            protocol.flush();
        } catch (Throwable t) {
            System.err.println("compiler process failed: " + t);
            status = 1;
        }
        Runtime.getRuntime().halt(status);
    }
}
