/**
 * Disassembler fixture: a class that walks straight out of the interpreter's int-only
 * subset. Nothing here is executable by the VM in this project — the point is the decoder,
 * which has to list every one of these instructions with the right mnemonic and skip its
 * operands by the right number of bytes.
 *
 * Between them the methods below make javac emit operands of every fixed width the opcode
 * table knows (1, 2, 3 and 4 bytes) plus both variable-length switches, which the decoder
 * is expected to stop at:
 *
 *   ldc, newarray            — 1 operand byte
 *   ldc2_w, getstatic, invokevirtual, invokespecial, new, anewarray, checkcast, instanceof
 *                            — 2 operand bytes
 *   multianewarray           — 3 operand bytes
 *   invokeinterface, invokedynamic
 *                            — 4 operand bytes
 *   tableswitch, lookupswitch — variable length, sized by padding and operands
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
