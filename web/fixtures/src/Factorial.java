/**
 * Recursive factorial — the simplest example of a call stack growing and unwinding.
 *
 * <p>Running {@code factorial(4)} creates five frames ({@code main} plus four recursive
 * calls), so the call stack panel shows the full cycle: descending into the recursion,
 * hitting the base case and unwinding while multiplying the results on the way back.
 *
 * <p>The program stays inside the JVM instruction subset the interpreter supports: only
 * {@code int} arithmetic and static methods of the same class. There is no
 * {@code System.out.println} and no static field — the program result is stored in the
 * local variable {@code result} in {@code main}.
 */
public final class Factorial {

    private Factorial() {
        // Utility class — never instantiated.
    }

    /**
     * Computes {@code n!} recursively.
     *
     * @param n a non-negative number
     * @return the factorial of {@code n}; for {@code n <= 1} the base case value 1
     */
    static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = factorial(4); // 24
    }
}
