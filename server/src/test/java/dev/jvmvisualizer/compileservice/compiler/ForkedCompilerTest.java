package dev.jvmvisualizer.compileservice.compiler;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;

class ForkedCompilerTest {

    private static final String ADDER = """
            public class Adder {
                public static void main(String[] args) {
                    int sum = add(2, 3);
                }

                static int add(int a, int b) {
                    return a + b;
                }
            }
            """;

    private static final String RUNAWAY = runaway(24);

    @Test
    @Timeout(60)
    void compilesInAChildProcess() {
        try (ForkedCompiler compiler = new ForkedCompiler(Duration.ofSeconds(30), 1)) {
            CompilationResult result = compiler.compile(ADDER);

            assertThat(result).isInstanceOfSatisfying(CompilationResult.Success.class, success -> {
                assertThat(success.className()).isEqualTo("Adder");
                assertThat(success.classBytes()).isNotEmpty();
            });
        }
    }

    @Test
    @Timeout(60)
    void reportsDiagnosticsFromTheChildProcess() {
        try (ForkedCompiler compiler = new ForkedCompiler(Duration.ofSeconds(30), 1)) {
            CompilationResult result = compiler.compile("public class Broken { int value() { return 1 } }");

            assertThat(result).isInstanceOf(CompilationResult.Failure.class);
            assertThat(result.diagnostics()).isNotEmpty();
            assertThat(result.diagnostics()).allSatisfy(diagnostic ->
                    assertThat(diagnostic.message()).isNotBlank());
        }
    }

    @Test
    @Timeout(60)
    void killsTheCompilerWhenTheDeadlinePassesAndLeavesNoProcessBehind() throws Exception {
        long before = childProcesses();
        long threadsBefore = compileThreads();

        try (ForkedCompiler compiler = new ForkedCompiler(Duration.ofSeconds(2), 1)) {
            long start = System.nanoTime();
            CompilationResult result = compiler.compile(RUNAWAY);
            Duration elapsed = Duration.ofNanos(System.nanoTime() - start);

            assertThat(result).isInstanceOf(CompilationResult.Failure.class);
            assertThat(result.diagnostics()).extracting(CompilerDiagnostic::message)
                    .containsExactly(ForkedCompiler.TIMEOUT_MESSAGE);
            assertThat(elapsed).isLessThan(Duration.ofSeconds(20));
        }

        assertThat(waitForChildProcesses(before)).isEqualTo(before);
        assertThat(waitFor(ForkedCompilerTest::compileThreads, threadsBefore)).isEqualTo(threadsBefore);
    }

    @Test
    @Timeout(60)
    void refusesToStartMoreCompilationsThanItHasSlots() throws Exception {
        long before = childProcesses();
        CountDownLatch started = new CountDownLatch(1);
        AtomicReference<CompilationResult> occupied = new AtomicReference<>();

        try (ForkedCompiler compiler = new ForkedCompiler(Duration.ofSeconds(3), 1)) {
            Thread holder = new Thread(() -> {
                started.countDown();
                occupied.set(compiler.compile(RUNAWAY));
            }, "slot-holder");
            holder.setDaemon(true);
            holder.start();

            assertThat(started.await(10, TimeUnit.SECONDS)).isTrue();
            waitForChildProcesses(before + 1);

            assertThatThrownBy(() -> compiler.compile(ADDER))
                    .isInstanceOf(CompilerBusyException.class)
                    .hasMessageContaining("capacity");

            holder.join(30_000);
            assertThat(occupied.get()).isInstanceOf(CompilationResult.Failure.class);
        }

        assertThat(waitForChildProcesses(before)).isEqualTo(before);
    }

    @Test
    @Timeout(60)
    void killsEveryRunningCompilerOnShutdown() throws Exception {
        long before = childProcesses();
        CountDownLatch started = new CountDownLatch(1);

        ForkedCompiler compiler = new ForkedCompiler(Duration.ofSeconds(30), 1);
        Thread holder = new Thread(() -> {
            started.countDown();
            compiler.compile(RUNAWAY);
        }, "slot-holder");
        holder.setDaemon(true);
        holder.start();

        assertThat(started.await(10, TimeUnit.SECONDS)).isTrue();
        assertThat(waitForChildProcesses(before + 1)).isEqualTo(before + 1);

        compiler.close();

        assertThat(waitForChildProcesses(before)).isEqualTo(before);
    }

    private static long childProcesses() {
        return ProcessHandle.current().descendants().count();
    }

    private static long compileThreads() {
        return Thread.getAllStackTraces().keySet().stream()
                .filter(Thread::isAlive)
                .filter(thread -> thread.getName().startsWith("compile-"))
                .count();
    }

    private static long waitForChildProcesses(long expected) throws InterruptedException {
        return waitFor(ForkedCompilerTest::childProcesses, expected);
    }

    private static long waitFor(LongSupplier actual, long expected) throws InterruptedException {
        long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
        long count = actual.getAsLong();
        while (count != expected && System.nanoTime() < deadline) {
            Thread.sleep(50);
            count = actual.getAsLong();
        }
        return count;
    }

    private static String runaway(int depth) {
        StringBuilder expression = new StringBuilder("\"x\"");
        for (int i = 0; i < depth; i++) {
            expression.insert(0, "pair(").append(")");
        }
        return """
                public class Runaway {
                    static <A> java.util.Map<A, A> pair(A a) { return java.util.Map.of(a, a); }
                    static Object value = %s;
                }
                """.formatted(expression);
    }
}
