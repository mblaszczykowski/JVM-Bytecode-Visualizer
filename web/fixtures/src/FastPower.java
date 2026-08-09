/**
 * Exponentiation by squaring: {@code 3^13} in four iterations, where counting the exponent down one
 * at a time would take thirteen multiplications. Reading 13 as the bits {@code 1101},
 * {@code exponent & 1} is {@code iand} against a mask of one and answers whether the lowest bit is
 * set, and {@code exponent >>>= 1} is {@code iushr}, which throws that bit away and brings the next
 * one down. The exponent goes 13, 6, 3, 1 while the base climbs 3, 9, 81, 6561, leaving 1594323 in
 * the local variable {@code result}.
 */
public final class FastPower {

    private FastPower() {}

    /**
     * Raises {@code base} to the power of {@code exponent} in as many steps as the exponent
     * has bits.
     *
     * @param base the number to raise; the result wraps around like any other {@code int}
     * @param exponent a non-negative exponent
     * @return {@code base} raised to {@code exponent}; 1 for an exponent of 0
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
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = power(3, 13); // 1594323
    }
}
