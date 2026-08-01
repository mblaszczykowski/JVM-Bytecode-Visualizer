import java.io.OutputStream;
import java.io.PrintStream;
import java.util.function.IntSupplier;

/**
 * Build harness: computes the reference results of the examples on a REAL JVM.
 *
 * <p>It prints one {@code <id>=<value>} line per example; {@code build-fixtures.mjs} parses
 * that output and stores the values as {@code expectedResult} in {@code manifest.json}. Those
 * values drive the interpreter's differential test: the interpreter must return exactly what
 * a real JVM returned — not what a human typed in.
 *
 * <p>This file is NOT copied into {@code public/examples} — it is a build tool, not an example
 * to visualise. It may therefore freely use {@code System.out}, which the examples used to be
 * forbidden from doing; an example that prints has its output captured separately, by running
 * its {@code main} on its own.
 *
 * <p><strong>Keep in sync:</strong> the arguments below must match those in the {@code main}
 * methods of the examples — otherwise {@code expectedResult} in the manifest would describe a
 * different execution than the one the interpreter replays.
 */
public final class ExpectedResults {

    private ExpectedResults() {
        // Utility class — never instantiated.
    }

    public static void main(String[] args) {
        System.out.println("factorial=" + quietly(() -> Factorial.factorial(4)));
        System.out.println("fibonacci=" + quietly(() -> Fibonacci.fib(7)));
        System.out.println("sum-of-products=" + quietly(() -> SumOfProducts.sumOfProducts(6)));
        System.out.println("gcd=" + quietly(() -> Gcd.gcd(1071, 462)));
        System.out.println("bubble-sort=" + quietly(BubbleSort::sortedMinimum));
        System.out.println("collatz=" + quietly(() -> Collatz.stepsToOne(7)));
        System.out.println("days-in-year=" + quietly(DaysInYear::daysInYear));
        System.out.println("fast-power=" + quietly(() -> FastPower.power(3, 13)));
    }

    /**
     * Runs a computation with {@code System.out} discarded.
     *
     * <p>An example is free to print, and one of them does. Its output belongs to the example
     * and is captured from a run of its own; here it would interleave with the
     * {@code <id>=<value>} lines and corrupt the protocol, so it goes nowhere.
     *
     * @param computation the reference computation of one example
     * @return whatever the computation returned
     */
    private static int quietly(IntSupplier computation) {
        PrintStream stdout = System.out;
        System.setOut(new PrintStream(OutputStream.nullOutputStream()));
        try {
            return computation.getAsInt();
        } finally {
            System.setOut(stdout);
        }
    }
}
