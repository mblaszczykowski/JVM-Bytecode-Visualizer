/**
 * Fixture for the step limit: a loop the interpreter can run forever, using only supported
 * instructions, so the run can end no other way.
 *
 * <p>Compiled into this directory with:
 * {@code javac -g --release 21 -d web/src/services/__fixtures__ InfiniteLoop.java}
 */
public final class InfiniteLoop {

    private InfiniteLoop() {
        // Utility class — never instantiated.
    }

    public static void main(String[] args) {
        int result = 0;
        while (true) {
            result++;
        }
    }
}
