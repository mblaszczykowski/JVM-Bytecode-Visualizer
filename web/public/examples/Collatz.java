/**
 * The Collatz sequence, printed term by term — the example that fills the console.
 *
 * <p>Halve an even number, triple an odd one and add one, then start again. From 7 the
 * sequence climbs as high as 52 before it finally falls to 1, sixteen steps later. Whether
 * every starting value reaches 1 is still an open problem; that this one does is worth
 * watching happen.
 *
 * <p>Every term is printed the moment it is computed, so the console grows by one line per
 * iteration and ends up holding the whole sequence rather than a summary of it. Each
 * {@code System.out.println} is three instructions: {@code getstatic} reads the
 * {@code System.out} stream, {@code iload} puts the number next to it, and
 * {@code invokevirtual} hands both to {@code println}.
 *
 * <p>The number of steps the sequence needed is also left in the local variable
 * {@code result}, so the run has an answer as well as an output.
 */
public final class Collatz {

    private Collatz() {
        // Utility class — never instantiated.
    }

    /**
     * Prints the Collatz sequence that starts at {@code start} and counts how long it is.
     *
     * @param start a positive number to start the sequence from
     * @return the number of steps taken to reach 1; 0 when the sequence starts there
     */
    static int stepsToOne(int start) {
        int n = start;
        int steps = 0;
        System.out.println(n);

        while (n != 1) {
            if (n % 2 == 0) {
                n = n / 2;
            } else {
                n = 3 * n + 1;
            }
            steps++;
            System.out.println(n);
        }
        return steps;
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = stepsToOne(7); // 16
    }
}
