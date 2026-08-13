/**
 * Fixture for the "instruction outside the supported subset" path.
 *
 * <p>The loop stays inside the int-only subset the interpreter runs, so the history is several
 * steps long before the widening conversion to {@code long}. That is a 64-bit value this machine
 * has no pair of slots for, so the instruction stops the run.
 *
 * <p>Rebuilt by fixtures/build-test-fixtures.mjs (javac -g --release 21) and byte-diffed in CI.
 */
public final class UnsupportedInstruction {

    private UnsupportedInstruction() {
    }

    public static void main(String[] args) {
        int result = 0;
        for (int i = 1; i <= 3; i++) {
            result += i;
        }
        long widened = result;
        System.out.println(widened);
    }
}
