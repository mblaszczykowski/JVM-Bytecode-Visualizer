/**
 * Fixture parsera (plan.md §9 Faza 1). Rekurencyjna silnia — celowo bez
 * System.out.println i bez pól statycznych (plan.md §5.4): wynik ląduje
 * w zmiennej lokalnej `result`, dzięki czemu program mieści się w zakresie
 * instrukcji MVP (plan.md §6) i nie generuje <clinit>.
 *
 * Kompilacja (dokładnie ta komenda produkuje commitowany Factorial.class):
 *   javac -g --release 21 Factorial.java
 *
 * Flaga -g daje LocalVariableTable (nazwy zmiennych w UI), --release 21
 * przypina major version 65 — na tym opierają się asercje w parser.test.ts.
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
