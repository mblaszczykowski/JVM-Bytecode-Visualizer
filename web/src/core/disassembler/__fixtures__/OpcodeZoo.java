/**
 * Disassembler fixture: between them these methods make javac emit an operand of every fixed
 * width the opcode table knows, plus both variable-length switches. Some of them decode
 * entirely inside the interpreter's int-only subset (table, lookup, array) and some reach well
 * outside it (ldc2_w, anewarray, multianewarray, invokeinterface, invokedynamic). The decoder
 * has to list either kind with the right mnemonic and skip its operands by the right number of
 * bytes:
 *
 *   ldc, newarray            - 1 operand byte
 *   ldc2_w, getstatic, invokevirtual, invokespecial, new, anewarray, checkcast, instanceof
 *                            - 2 operand bytes
 *   multianewarray           - 3 operand bytes
 *   invokeinterface, invokedynamic
 *                            - 4 operand bytes, the last of which javap does not print
 *   tableswitch, lookupswitch - variable length: the decoder steps over the padding and every
 *                              arm rather than stopping at the instruction
 *
 * Compilation (this exact command produces the committed OpcodeZoo.class):
 *   javac -g --release 21 OpcodeZoo.java
 */
public class OpcodeZoo {

    /** Dense labels, so javac chooses tableswitch. */
    static int table(int n) {
        switch (n) {
            case 0:
                return 10;
            case 1:
                return 20;
            case 2:
                return 30;
            default:
                return -1;
        }
    }

    /** Labels far apart, so javac chooses lookupswitch instead. */
    static int lookup(int n) {
        switch (n) {
            case 1:
                return 1;
            case 500:
                return 2;
            case 100000:
                return 3;
            default:
                return 0;
        }
    }

    /** newarray with its one-byte array-type immediate. */
    static int array(int n) {
        int[] values = new int[3];
        values[0] = n;
        return values.length + values[0];
    }

    /** A constant too wide for sipush lands in the constant pool and arrives via ldc. */
    static int wide(int n) {
        return n + 123456789;
    }

    /** ldc2_w: a double constant occupies two constant pool slots. */
    static double half() {
        return 0.5d;
    }

    /** ldc reaching a float constant, which the pool stores as IEEE 754 bytes. */
    static float scale() {
        return 1.5f;
    }

    /** ldc2_w again, for a long too wide for any int the pool could hold. */
    static long offset() {
        return 4294967296L;
    }

    /** multianewarray, with its two-byte class index and one-byte dimension count. */
    static String[][] grid() {
        return new String[2][3];
    }

    /** anewarray for the reference array, plus aastore. */
    static Object[] names() {
        return new String[] {"a", "b"};
    }

    /** getstatic and invokevirtual, the shape every println has. */
    static void print(String text) {
        System.out.println(text);
    }

    /** new + invokespecial + invokeinterface through the List interface. */
    static int size(String text) {
        java.util.List<String> values = new java.util.ArrayList<>();
        values.add(text);
        return values.size();
    }

    /** String concatenation compiles to invokedynamic against StringConcatFactory. */
    static String greet(int n) {
        return "n=" + n;
    }

    /** instanceof and checkcast, both carrying a two-byte class index. */
    static boolean empty(Object value) {
        if (value instanceof String) {
            String text = (String) value;
            return text.isEmpty();
        }
        return false;
    }
}
