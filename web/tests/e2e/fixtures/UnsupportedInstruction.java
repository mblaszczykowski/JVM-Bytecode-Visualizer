/**
 * Fixture for the "instruction outside the supported subset" path.
 *
 * <p>The loop stays inside the int-only subset the interpreter runs, so the history is
 * several steps long before {@code System.out.println} needs {@code getstatic} — an
 * instruction that requires the heap, and therefore stops the run.
 *
 * <p>Compiled into this directory with:
 * {@code javac -g --release 21 -d web/tests/e2e/fixtures UnsupportedInstruction.java}
 */
public final class UnsupportedInstruction {

    private UnsupportedInstruction() {
        // Utility class — never instantiated.
    }

    public static void main(String[] args) {
        int result = 0;
        for (int i = 1; i <= 3; i++) {
            result += i;
        }
        System.out.println(result);
    }
}
