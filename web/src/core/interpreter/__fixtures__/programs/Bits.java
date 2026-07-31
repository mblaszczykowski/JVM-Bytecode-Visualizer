/**
 * Differential fixture: shifts, bitwise logic and the narrowing conversions, over the values
 * where they are easy to get wrong — both boundaries of the int range, and shift distances
 * above 31, which JVMS §6.5 (ishl, ishr, iushr) reduces to the low five bits of value2.
 *
 * Every result is printed, so the whole of Bits.stdout.txt is the assertion.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 Bits.java && java Bits > Bits.stdout.txt
 */
public class Bits {

    public static void main(String[] args) {
        int[] values = new int[8];
        values[0] = 0;
        values[1] = 1;
        values[2] = -1;
        values[3] = 255;
        values[4] = -255;
        values[5] = 65535;
        values[6] = 2147483647;
        values[7] = -2147483648;

        for (int i = 0; i < values.length; i++) {
            int value = values[i];
            for (int distance = 0; distance < 40; distance += 7) {
                System.out.println(value << distance);
                System.out.println(value >> distance);
                System.out.println(value >>> distance);
            }
            System.out.println(value & 252645135);
            System.out.println(value | 252645135);
            System.out.println(value ^ 252645135);
            System.out.println((byte) value);
            System.out.println((short) value);
            int asChar = (char) value;
            System.out.println(asChar);
        }
    }
}
