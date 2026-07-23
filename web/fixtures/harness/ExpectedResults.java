/**
 * Build harness: computes the reference results of the examples on a REAL JVM.
 *
 * <p>It prints one {@code <id>=<value>} line per example; {@code build-fixtures.mjs} parses
 * that output and stores the values as {@code expectedResult} in {@code manifest.json}. Those
 * values drive the interpreter's differential test: the interpreter must return exactly what
 * a real JVM returned — not what a human typed in.
 *
 * <p>This file is NOT copied into {@code public/examples} — it is a build tool, not an example
 * to visualise. It may therefore freely use {@code System.out}, which the examples must not.
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
        System.out.println("factorial=" + Factorial.factorial(4));
        System.out.println("fibonacci=" + Fibonacci.fib(7));
        System.out.println("sum-of-products=" + SumOfProducts.sumOfProducts(6));
        System.out.println("gcd=" + Gcd.gcd(1071, 462));
    }
}
