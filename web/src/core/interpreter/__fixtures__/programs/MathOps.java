/**
 * Differential fixture for the java.lang.Math intrinsics, over every pair of a handful of
 * values that includes both ends of the int range. The interesting ones are the overflows the
 * javadoc pins down: Math.abs(Integer.MIN_VALUE) and Math.floorDiv(Integer.MIN_VALUE, -1) are
 * both Integer.MIN_VALUE, because the result is not representable.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 MathOps.java && java MathOps > MathOps.stdout.txt
 */
public class MathOps {

    public static void main(String[] args) {
        int[] values = new int[9];
        values[0] = 0;
        values[1] = 1;
        values[2] = -1;
        values[3] = 7;
        values[4] = -7;
        values[5] = 2147483647;
        values[6] = -2147483648;
        values[7] = 1000000;
        values[8] = -1000000;

        for (int i = 0; i < values.length; i++) {
            int left = values[i];
            System.out.println(Math.abs(left));
            for (int j = 0; j < values.length; j++) {
                int right = values[j];
                System.out.println(Math.max(left, right));
                System.out.println(Math.min(left, right));
                if (right != 0) {
                    System.out.println(Math.floorDiv(left, right));
                    System.out.println(Math.floorMod(left, right));
                }
            }
        }
    }
}
