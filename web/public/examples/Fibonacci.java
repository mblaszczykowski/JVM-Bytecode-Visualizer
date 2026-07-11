/**
 * Naive, branching Fibonacci recursion — an example with an exponential number of calls.
 *
 * <p>Unlike factorial, every frame calls itself <em>twice</em>, so the stack grows and
 * unwinds many times over: {@code fib(7)} is 41 calls and several hundred bytecode steps.
 * That makes this example a good one for scrubbing through the execution history, and for
 * seeing why naive recursion is expensive — the same subproblems are recomputed from scratch.
 *
 * <p>There is no {@code System.out.println} and no static field; the result is stored in the
 * local variable {@code result}.
 */
public final class Fibonacci {

    private Fibonacci() {
        // Utility class — never instantiated.
    }

    /**
     * Returns the n-th Fibonacci number computed straight from the definition.
     *
     * @param n zero-based index of the term ({@code fib(0) == 0}, {@code fib(1) == 1})
     * @return the value of the n-th term of the sequence
     */
    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = fib(7); // 13
    }
}
