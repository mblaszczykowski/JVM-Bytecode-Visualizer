/**
 * Differential fixture for the two switch instructions (JVMS §6.5 tableswitch, lookupswitch).
 * Dense labels make javac choose `tableswitch`, labels far apart make it choose
 * `lookupswitch`, and the third method falls through from arm to arm so the dispatch is not
 * the only thing being checked.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 Switches.java && java Switches > Switches.stdout.txt
 */
public class Switches {

    /** Dense labels, so javac chooses tableswitch. */
    static int table(int n) {
        switch (n) {
            case 0:
                return 10;
            case 1:
                return 20;
            case 2:
                return 30;
            case 3:
                return 40;
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

    /** No break until the third arm, so control walks from one arm into the next. */
    static int fallThrough(int n) {
        int total = 0;
        switch (n) {
            case 0:
                total += 1;
            case 1:
                total += 2;
            case 2:
                total += 4;
                break;
            case 3:
                total += 8;
        }
        return total;
    }

    public static void main(String[] args) {
        for (int n = -2; n <= 5; n++) {
            System.out.println(table(n));
            System.out.println(fallThrough(n));
        }

        int[] probes = new int[6];
        probes[0] = 0;
        probes[1] = 1;
        probes[2] = 500;
        probes[3] = 100000;
        probes[4] = 499;
        probes[5] = -1;
        for (int i = 0; i < probes.length; i++) {
            System.out.println(lookup(probes[i]));
        }
    }
}
