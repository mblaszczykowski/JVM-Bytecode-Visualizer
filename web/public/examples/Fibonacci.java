/**
 * Naiwna, rozgałęziona rekurencja Fibonacciego — przykład o wykładniczej liczbie wywołań.
 *
 * <p>W przeciwieństwie do silni każda ramka wywołuje się <em>dwa</em> razy, więc stos rośnie
 * i zwija się wielokrotnie: {@code fib(7)} to 41 wywołań i kilkaset kroków bajtkodu.
 * Dzięki temu przykład dobrze pokazuje przewijanie (scrubbing) historii wykonania i to,
 * dlaczego naiwna rekurencja jest kosztowna — te same podproblemy liczone są od nowa.
 *
 * <p>Program mieści się w podzbiorze instrukcji z plan.md §6 i respektuje ograniczenia §5.4
 * (bez {@code System.out.println}, bez pól statycznych, wynik do lokalnej {@code result}).
 */
public final class Fibonacci {

    private Fibonacci() {
        // Klasa narzędziowa — instancji nie tworzymy.
    }

    /**
     * Zwraca n-ty wyraz ciągu Fibonacciego liczony wprost z definicji.
     *
     * @param n indeks wyrazu, liczony od zera ({@code fib(0) == 0}, {@code fib(1) == 1})
     * @return wartość n-tego wyrazu ciągu
     */
    static int fib(int n) {
        if (n < 2) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }

    /**
     * Punkt wejścia interpretera. Parametr {@code args} jest celowo nieużywany —
     * slot 0 ramki {@code main} trzyma wartownika, którego żadna instrukcja z §6 nie czyta.
     */
    public static void main(String[] args) {
        int result = fib(7); // 13
    }
}
