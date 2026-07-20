package dev.jvmvisualizer.compileservice.compiler;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.FileDescriptor;
import java.io.FileOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

/**
 * Entry point of a compiler child process: read the source from stdin, compile it with
 * {@link InMemoryCompiler}, write the result to stdout as JSON, exit.
 *
 * <p>This exists so the compile timeout is real. {@code Future.cancel(true)} only raises an
 * interrupt flag, and javac never polls it — a pathological source keeps a thread spinning long
 * after the request is over. A child process can be killed, and {@link ForkedCompiler} kills it.
 *
 * <p>stdout is the protocol, so the first thing this does is take the real stdout for itself and
 * point {@code System.out} at stderr: a stray {@code println} or a logging framework defaulting to
 * the console must not be able to corrupt the JSON document.
 */
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
            // Includes StackOverflowError and OutOfMemoryError: this JVM exists to absorb them.
            System.err.println("compiler process failed: " + t);
            status = 1;
        }
        // halt, not exit: there is no state worth a clean shutdown and no hook worth waiting for.
        Runtime.getRuntime().halt(status);
    }
}
