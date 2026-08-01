/**
 * Exponentiation by squaring — the example where the bits of a number are the algorithm.
 *
 * <p>{@code 3^13} needs thirteen multiplications only if the exponent is counted down one at
 * a time. Read 13 as the bits {@code 1101} instead and four are enough: square the base at
 * every step, and fold it into the product only for the bits that are set.
 *
 * <p>That reading is what the bitwise instructions do here. {@code exponent & 1} is
 * {@code iand} against a mask of one, and it answers the only question the loop asks: is the
 * lowest bit set? {@code exponent >>>= 1} is {@code iushr}, which throws that bit away and
 * brings the next one down. The exponent goes 13, 6, 3, 1 while the base climbs
 * 3, 9, 81, 6561 — the loop ends the moment the exponent runs out of bits.
 *
 * <p>There is no {@code System.out.println} and no static field; the result — 1594323 — is
 * stored in the local variable {@code result}.
 */
public final class FastPower {

    private FastPower() {
        // Utility class — never instantiated.
    }

    /**
     * Raises {@code base} to the power of {@code exponent} in as many steps as the exponent
     * has bits.
     *
     * @param base the number to raise; the result wraps around like any other {@code int}
     * @param exponent a non-negative exponent — the unsigned shift below says as much
     * @return {@code base} raised to {@code exponent}, and 1 for an exponent of 0
     */
    static int power(int base, int exponent) {
        int factor = base;
        int product = 1;

        while (exponent != 0) {
            // The lowest bit decides whether this power of the base belongs to the product.
            if ((exponent & 1) != 0) {
                product = product * factor;
            }
            factor = factor * factor;
            exponent = exponent >>> 1;
        }
        return product;
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = power(3, 13); // 1594323
    }
}
