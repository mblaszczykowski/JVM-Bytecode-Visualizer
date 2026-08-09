/**
 * Naive branching Fibonacci recursion. Every frame calls itself twice, so {@code fib(7)} takes 41
 * calls and several hundred bytecode steps: long enough to scrub through, and enough to show the
 * same subproblems being recomputed from scratch. The result is left in the local variable
 * {@code result}.
 */
public final class Fibonacci {

    private Fibonacci() {}

    /**
     * Returns the n-th Fibonacci number, computed straight from the definition.
     *
     * @param n zero-based index of the term ({@code fib(0) == 0}, {@code fib(1) == 1})
     */
    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }

    /**
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = fib(7); // 13
    }
}
