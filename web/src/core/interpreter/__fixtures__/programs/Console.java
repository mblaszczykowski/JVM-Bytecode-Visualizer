/**
 * Differential fixture for System.out: every println and print overload the interpreter
 * recognises, including the no-argument println that ends a line begun by print, and a String
 * held in a local variable rather than passed straight from the constant pool.
 *
 * Compilation and reference run (this exact command produces the committed files):
 *   javac -g --release 21 Console.java && java Console > Console.stdout.txt
 */
public class Console {

    public static void main(String[] args) {
        System.out.println();
        System.out.println(42);
        System.out.println(-1);
        System.out.println("hello");
        System.out.println("");
        System.out.println(true);
        System.out.println(false);
        System.out.println('A');

        System.out.print("a");
        System.out.print("b");
        System.out.println("c");

        System.out.print(1);
        System.out.print(2);
        System.out.println(3);

        String greeting = "from a local";
        System.out.println(greeting);

        System.out.print(greeting);
        System.out.println();
    }
}
