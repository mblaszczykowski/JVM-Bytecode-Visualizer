/**
 * Nested {@code for} loops — an example without recursion, with a flat stack and a long
 * execution history instead.
 *
 * <p>It sums the products {@code i * j} over a square {@code n x n} grid; on the diagonal
 * ({@code i == j}) the terms are consecutive squares, which is where the name comes from.
 * For {@code n = 6} the grid has 36 cells, giving roughly 470 bytecode steps — enough to see
 * {@code iinc} in action (incrementing the counter in place, without touching the operand
 * stack), {@code if_icmpgt} (the loop condition) and the backward {@code goto} jump.
 *
 * <p>There is no {@code System.out.println} and no static field; the result is stored in the
 * local variable {@code result}.
 */
public final class SumOfSquares {

    private SumOfSquares() {
        // Utility class — never instantiated.
    }

    /**
     * Sums the products {@code i * j} for every pair drawn from the range {@code 1..n}.
     *
     * @param n side of the grid; for {@code n <= 0} the loops do not run a single iteration
     * @return the sum of all products, i.e. the square of the n-th triangular number
     */
    static int sumOfSquares(int n) {
        int sum = 0;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= n; j++) {
                sum += i * j;
            }
        }
        return sum;
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = sumOfSquares(6); // 441
    }
}
