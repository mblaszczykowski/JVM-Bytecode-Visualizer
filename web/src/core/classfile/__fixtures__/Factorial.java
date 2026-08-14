/**
 * Parser fixture: recursive factorial. It prints nothing and declares no static
 * field, so its constant pool stays small enough to transcribe by hand: the
 * parser tests assert on individual entries, and a println or a <clinit> would
 * add entries that have nothing to do with what they check.
 *
 * Compilation (this exact command produces the committed Factorial.class):
 *   javac -g --release 21 Factorial.java
 *
 * The -g flag yields a LocalVariableTable (variable names in the UI) and
 * --release 21 pins major version 65; parser.test.ts asserts on both.
 */
public class Factorial {
    public static void main(String[] args) {
        int result = factorial(4);
    }

    static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }
}
