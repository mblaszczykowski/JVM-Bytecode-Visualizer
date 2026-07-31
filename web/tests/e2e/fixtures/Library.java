/**
 * A utility class: static helpers, a private constructor and no `main`. Nothing here is a
 * Java entry point, and every helper takes arguments, so this interpreter has no method it
 * can enter — the fixture for a class file that can only be read.
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
