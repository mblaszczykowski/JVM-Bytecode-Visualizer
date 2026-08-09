/**
 * Recursive factorial. {@code factorial(4)} builds five frames ({@code main} plus four recursive
 * calls), so the call stack grows down to the base case and then unwinds, multiplying results on
 * the way back. The result is left in the local variable {@code result}.
 */
public final class Factorial {

    private Factorial() {}

    /**
     * Computes {@code n!} recursively.
     *
     * @param n a non-negative number
     * @return {@code n!}; 1 for {@code n <= 1}
     */
    static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    /**
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = factorial(4); // 24
    }
}
