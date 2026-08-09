/**
 * Nested {@code for} loops, no recursion: a flat call stack and a long execution history. Summing
 * {@code i * j} over a 6 x 6 grid covers 36 cells in roughly 470 bytecode steps, which is enough to
 * see {@code iinc} (incrementing the counter in place, without touching the operand stack),
 * {@code if_icmpgt} (the loop condition) and the backward {@code goto}. The result is left in the
 * local variable {@code result}.
 */
public final class SumOfProducts {

    private SumOfProducts() {}

    /**
     * Sums the products {@code i * j} for every pair drawn from the range {@code 1..n}.
     *
     * @param n side of the grid; {@code n <= 0} runs no iterations at all
     * @return the sum of all products, i.e. the square of the n-th triangular number
     */
    static int sumOfProducts(int n) {
        int sum = 0;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= n; j++) {
                sum += i * j;
            }
        }
        return sum;
    }

    /**
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = sumOfProducts(6); // 441
    }
}
