/**
 * Differential fixture for the exception table and `athrow` (JVMS §2.10, §4.7.3, §6.5).
 *
 * Every exception here is one the *machine* raises: a division by zero, an index off the end
 * of an array, a null reference, a negative array length. That is not a shortcut, it is the
 * whole scope: nothing in the executable subset can construct an object, so `throw new ...`
 * has nothing to throw. What can be checked is everything that happens afterwards, and that
 * is what this file is: matching a handler, matching one by supertype, picking the first of
 * several, unwinding across a frame that has no handler, `finally` on both paths, rethrowing
 * a caught exception with `athrow`, and the one throw the subset can write for itself,
 * `throw null`.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 Exceptions.java && java Exceptions > Exceptions.stdout.txt
 */
public class Exceptions {

    /** The plainest shape: the machine raises it, the handler catches it, the run carries on. */
    static int divide(int a, int b) {
        try {
            return a / b;
        } catch (ArithmeticException e) {
            return -1;
        }
    }

    /** Caught by a supertype: ArithmeticException is a RuntimeException is an Exception. */
    static int caughtBySupertype(int a, int b) {
        try {
            return a / b;
        } catch (Exception e) {
            return -2;
        }
    }

    /**
     * Two handlers over the same range. The rows are in source order and the first one that
     * matches wins, so the specific clause must win over the one that would also match.
     */
    static int firstMatchingHandler(int index) {
        int[] a = new int[2];
        try {
            return a[index];
        } catch (ArrayIndexOutOfBoundsException e) {
            return -3;
        } catch (RuntimeException e) {
            return -4;
        }
    }

    /** No handler of its own: whatever this raises belongs to whoever called it. */
    static int raise(int n) {
        return 100 / n;
    }

    /** The exception crosses a frame boundary and is caught one level down the stack. */
    static int acrossFrames(int n) {
        try {
            return raise(n);
        } catch (ArithmeticException e) {
            return -5;
        }
    }

    /** Catches, then throws the very same object again, which is where `athrow` comes from. */
    static int rethrowing(int n) {
        try {
            return 1 / n;
        } catch (ArithmeticException e) {
            throw e;
        }
    }

    /** Catches what `rethrowing` threw back, so the rethrown object has somewhere to land. */
    static int catchesRethrown(int n) {
        try {
            return rethrowing(n);
        } catch (ArithmeticException e) {
            return -6;
        }
    }

    /**
     * `finally` on both paths. javac compiles it as a catch-all row (catch_type 0) that stores
     * the exception, runs the block and throws it again, so this exercises the row that
     * matches everything as well as the ordinary one.
     */
    static int withFinally(int n) {
        int total;
        try {
            total = 10 / n;
        } catch (ArithmeticException e) {
            total = 5;
        } finally {
            total = -100;
        }
        return total;
    }

    /** NullPointerException, reached without any way to build an object. */
    static int nullLength() {
        int[] a = null;
        try {
            return a.length;
        } catch (NullPointerException e) {
            return -7;
        }
    }

    static int negativeSize(int n) {
        try {
            int[] a = new int[n];
            return a.length;
        } catch (NegativeArraySizeException e) {
            return -8;
        }
    }

    /** A handler that is on the stack but whose range does not cover the throwing offset. */
    static int outOfRange(int n) {
        int safe = 0;
        try {
            safe = n + 1;
        } catch (ArithmeticException e) {
            safe = -9;
        }
        return 10 / (safe - safe);
    }

    /**
     * `throw null` compiles to aconst_null followed by athrow. JVMS §6.5 (athrow) says that a
     * null objectref raises a NullPointerException, so this catch clause is the one that runs.
     */
    static int throwingNull() {
        try {
            throw null;
        } catch (NullPointerException e) {
            return -11;
        }
    }

    /** The NullPointerException athrow raised has to unwind like any other. */
    static int throwingNullAcrossFrames() {
        try {
            return rethrowNull();
        } catch (NullPointerException e) {
            return -12;
        }
    }

    static int rethrowNull() {
        throw null;
    }

    static int outOfRangeCaught(int n) {
        try {
            return outOfRange(n);
        } catch (ArithmeticException e) {
            return -10;
        }
    }

    public static void main(String[] args) {
        System.out.println(divide(10, 2));
        System.out.println(divide(10, 0));
        System.out.println(caughtBySupertype(7, 3));
        System.out.println(caughtBySupertype(7, 0));
        System.out.println(firstMatchingHandler(0));
        System.out.println(firstMatchingHandler(5));
        System.out.println(acrossFrames(4));
        System.out.println(acrossFrames(0));
        System.out.println(catchesRethrown(1));
        System.out.println(catchesRethrown(0));
        System.out.println(withFinally(2));
        System.out.println(withFinally(0));
        System.out.println(nullLength());
        System.out.println(negativeSize(3));
        System.out.println(negativeSize(-1));
        System.out.println(outOfRangeCaught(1));
        System.out.println(throwingNull());
        System.out.println(throwingNullAcrossFrames());
    }
}
