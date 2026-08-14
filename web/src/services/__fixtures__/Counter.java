/**
 * A class whose entry point is not called `main`: `count()` takes no arguments and returns an
 * int, so a run can start there. `step(int)` cannot, and is listing-only.
 *
 * Rebuilt by fixtures/build-test-fixtures.mjs (javac -g --release 21) and byte-diffed in CI.
 */
public final class Counter {
    static int count() {
        int total = 0;
        for (int i = 1; i <= 5; i++) {
            total = step(total);
        }
        return total;
    }

    static int step(int total) {
        return total + 3;
    }
}
