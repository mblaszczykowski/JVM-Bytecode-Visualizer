/**
 * Rekurencyjna silnia — najprostszy przykład rosnącego i zwijającego się stosu wywołań.
 *
 * <p>Wykonanie {@code factorial(4)} tworzy pięć ramek ({@code main} + cztery wywołania
 * rekurencyjne), więc panel "call stack" pokazuje pełny cykl: zejście w dół rekurencji,
 * osiągnięcie przypadku bazowego i zwijanie stosu z mnożeniem wyników przy powrotach.
 *
 * <p>Program mieści się w podzbiorze instrukcji JVM obsługiwanym przez interpreter
 * (plan.md §6): wyłącznie arytmetyka na {@code int} i statyczne metody tej samej klasy.
 * Zgodnie z plan.md §5.4 nie ma tu {@code System.out.println} ani pól statycznych —
 * wynik programu odkłada się do zmiennej lokalnej {@code result} w {@code main}.
 */
public final class Factorial {

    private Factorial() {
        // Klasa narzędziowa — instancji nie tworzymy.
    }

    /**
     * Liczy {@code n!} rekurencyjnie.
     *
     * @param n liczba nieujemna
     * @return silnia z {@code n}; dla {@code n <= 1} przypadek bazowy równy 1
     */
    static int factorial(int n) {
        if (n <= 1) {
            return 1;
        }
        return n * factorial(n - 1);
    }

    /**
     * Punkt wejścia interpretera. Parametr {@code args} jest celowo nieużywany —
     * slot 0 ramki {@code main} trzyma wartownika, którego żadna instrukcja z §6 nie czyta.
     */
    public static void main(String[] args) {
        int result = factorial(4); // 24
    }
}
