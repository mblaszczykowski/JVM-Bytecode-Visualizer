/**
 * Euclid's algorithm, iterative version — a {@code while} loop and the {@code irem} instruction.
 *
 * <p>The example shows a condition-driven loop rather than a counter-driven one: instead of
 * {@code iinc} and {@code if_icmpgt} it uses {@code ifne} on the remainder, plus copying local
 * variables between slots. Three iterations are enough to take the pair (1071, 462) down to 21.
 *
 * <p>There is no {@code System.out.println} and no static field; the result is stored in the
 * local variable {@code result}.
 */
public final class Gcd {

    private Gcd() {
        // Utility class — never instantiated.
    }

    /**
     * Greatest common divisor computed with Euclid's remainder algorithm.
     *
     * @param a the first number
     * @param b the second number; when it is zero the result is {@code a}
     * @return the greatest common divisor of both numbers
     */
    static int gcd(int a, int b) {
        while (b != 0) {
            int remainder = a % b;
            a = b;
            b = remainder;
        }
        return a;
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = gcd(1071, 462); // 21
    }
}
