/**
 * A utility class: static helpers, a private constructor and no `main`. Every helper takes
 * arguments, so this interpreter has no method it can enter. The fixture for a class file that
 * can only be read.
 *
 * Rebuilt by fixtures/build-test-fixtures.mjs (javac -g --release 21) and byte-diffed in CI.
 */
public final class Library {
    private Library() {
    }

    static int twice(int value) {
        return value * 2;
    }

    static int clamp(int value, int low, int high) {
        if (value < low) {
            return low;
        }
        return value > high ? high : value;
    }
}
