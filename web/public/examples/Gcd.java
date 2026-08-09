/**
 * Euclid's algorithm, iterative. The {@code while} condition compiles to {@code ifne} on the
 * remainder from {@code irem}, and the body copies values between local variable slots. Three
 * iterations take the pair (1071, 462) down to 21, which is left in the local variable
 * {@code result}.
 */
public final class Gcd {

    private Gcd() {}

    /**
     * Greatest common divisor by Euclid's remainder algorithm.
     *
     * @param b when it is zero the result is {@code a}
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
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = gcd(1071, 462); // 21
    }
}
