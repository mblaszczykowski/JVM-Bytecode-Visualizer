/**
 * Fixture for the step limit: a loop the interpreter can run forever, using only supported
 * instructions, so the run can end no other way.
 *
 * <p>Rebuilt by fixtures/build-test-fixtures.mjs (javac -g --release 21) and byte-diffed in
 * CI against the committed class file.
 */
public final class InfiniteLoop {

    private InfiniteLoop() {
    }

    public static void main(String[] args) {
        int result = 0;
        while (true) {
            result++;
        }
    }
}
