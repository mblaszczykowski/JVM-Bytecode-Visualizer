/**
 * Parser fixture: recursive factorial. Deliberately free of System.out.println
 * and of static fields — the result lands in the local variable `result`, which
 * keeps the program inside the supported instruction subset and avoids
 * generating a <clinit>.
 *
 * Compilation (this exact command produces the committed Factorial.class):
 *   javac -g --release 21 Factorial.java
 *
 * The -g flag yields a LocalVariableTable (variable names in the UI) and
 * --release 21 pins major version 65 — parser.test.ts asserts on both.
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
