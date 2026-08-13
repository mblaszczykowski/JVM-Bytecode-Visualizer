/**
 * Differential fixture for the operand-stack shuffles javac emits for ordinary int code
 * (JVMS §6.5). An assignment used as a value is what produces them: `t = a[i] = v` leaves the
 * stored value behind with dup_x2, because the array reference and the index are still under
 * it; `v = i = n` needs only dup; and a compound assignment to an array element duplicates the
 * reference and the index together with dup2.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 StackOps.java && java StackOps > StackOps.stdout.txt
 */
public class StackOps {

    public static void main(String[] args) {
        int[] a = new int[4];

        int t = a[0] = 5;
        System.out.println(t);
        System.out.println(a[0]);

        int u = a[1] = a[2] = 7;
        System.out.println(u);
        System.out.println(a[1]);
        System.out.println(a[2]);

        a[3] = 2;
        a[3] += 9;
        System.out.println(a[3]);

        int i = 0;
        int v = i = 11;
        System.out.println(v);
        System.out.println(i);

        int last = a[3] = a[0] + a[1] + a[2] + v;
        System.out.println(last);
        System.out.println(a[3]);
    }
}
