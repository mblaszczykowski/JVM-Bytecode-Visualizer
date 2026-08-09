/**
 * The Collatz sequence, printed term by term. Halve an even number, triple an odd one and add one:
 * from 7 the sequence climbs as high as 52 before falling to 1, sixteen steps later. Every term is
 * printed as it is computed, and each {@code System.out.println} is three instructions
 * ({@code getstatic} reads the {@code System.out} stream, {@code iload} puts the number next to it,
 * {@code invokevirtual} hands both to {@code println}); the number of steps is left in the local
 * variable {@code result}.
 */
public final class Collatz {

    private Collatz() {}

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
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = stepsToOne(7); // 16
    }
}
