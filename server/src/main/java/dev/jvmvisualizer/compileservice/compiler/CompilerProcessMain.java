package dev.jvmvisualizer.compileservice.compiler;

import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;

public final class CompilerProcessMain {

    private CompilerProcessMain() {
    }

    public static void main(String[] args) {
        PrintStream protocol = new PrintStream(new FileOutputStream(FileDescriptor.out), false, StandardCharsets.UTF_8);
        System.setOut(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));

        int status = 0;
        try {
            ObjectMapper objectMapper = JsonMapper.builder().build();
            CompilerProcessProtocol.Request request =
                    objectMapper.readValue(System.in.readAllBytes(), CompilerProcessProtocol.Request.class);
            CompilationResult result = new InMemoryCompiler().compile(request.toUnit());
            protocol.write(objectMapper.writeValueAsBytes(CompilerProcessProtocol.Payload.of(result)));
            protocol.flush();
        } catch (Throwable t) {
            System.err.println("compiler process failed: " + t);
            status = 1;
        }
        Runtime.getRuntime().halt(status);
    }
}
