/**
 * Differential fixture for objects: `new`, `invokespecial`, `getfield`, `putfield`,
 * `invokevirtual` on an instance, `areturn`, and the reference comparisons that any code
 * walking a linked structure needs (JVMS §6.5).
 *
 * Everything here is one class, because that is the boundary: there is no second class file to
 * load, so an instance can only ever be of the class being executed. A linked list of that one
 * class is the smallest program that still exercises the whole of it — a constructor, an int
 * field written and read, a reference field pointing at another instance, an instance method
 * called on a receiver, a method returning `this`, and a loop that ends on `null`.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 Instances.java && java Instances > Instances.stdout.txt
 */
public class Instances {

    int value;
    Instances next;

    Instances(int value) {
        this.value = value;
    }

    /** getfield through `this`, and areturn's int counterpart. */
    int get() {
        return value;
    }

    /** putfield: the object outlives the frame that changed it. */
    void bump(int by) {
        value = value + by;
    }

    /** Returns the receiver, so the caller gets a reference back through `areturn`. */
    Instances link(Instances other) {
        next = other;
        return this;
    }

    /** A walk that ends on null — `ifnonnull` is what makes the loop terminate. */
    int sum() {
        int total = 0;
        Instances node = this;
        while (node != null) {
            total = total + node.value;
            node = node.next;
        }
        return total;
    }

    /** Length of the chain, so the shape is checked as well as the arithmetic. */
    int length() {
        int count = 0;
        Instances node = this;
        while (node != null) {
            count = count + 1;
            node = node.next;
        }
        return count;
    }

    /** Reference identity: the same object, not merely an equal one (`if_acmpeq`). */
    static int same(Instances left, Instances right) {
        return left == right ? 1 : 0;
    }

    public static void main(String[] args) {
        Instances a = new Instances(10);
        System.out.println(a.get());

        a.bump(5);
        System.out.println(a.get());
        System.out.println(a.value);

        Instances b = new Instances(7);
        Instances c = new Instances(3);
        a.link(b);
        b.link(c);

        System.out.println(a.sum());
        System.out.println(a.length());
        System.out.println(b.sum());
        System.out.println(c.sum());

        // A fresh instance starts at the defaults the JVM gives it, not at anything the
        // constructor was not asked to set.
        Instances fresh = new Instances(0);
        System.out.println(fresh.value);
        System.out.println(fresh.next == null ? 1 : 0);

        System.out.println(same(a, a));
        System.out.println(same(a, b));
        System.out.println(same(a.link(b), a));

        // The chain is unchanged by having been walked twice.
        System.out.println(a.sum());
    }
}
