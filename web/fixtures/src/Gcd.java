/**
 * Algorytm Euklidesa w wersji iteracyjnej — pętla {@code while} i instrukcja {@code irem}.
 *
 * <p>Przykład pokazuje pętlę sterowaną warunkiem (a nie licznikiem): zamiast {@code iinc}
 * i {@code if_icmpgt} zobaczymy tu {@code ifne} na wartości reszty z dzielenia oraz
 * przepisywanie zmiennych lokalnych między slotami. Trzy obroty pętli wystarczą,
 * by z pary (1071, 462) zejść do 21.
 *
 * <p>Program mieści się w podzbiorze instrukcji z plan.md §6 i respektuje ograniczenia §5.4
 * (bez {@code System.out.println}, bez pól statycznych, wynik do lokalnej {@code result}).
 */
public final class Gcd {

    private Gcd() {
        // Klasa narzędziowa — instancji nie tworzymy.
    }

    /**
     * Największy wspólny dzielnik liczony algorytmem Euklidesa z resztą.
     *
     * @param a pierwsza liczba
     * @param b druga liczba; gdy jest zerem, wynikiem jest {@code a}
     * @return NWD obu liczb
     */
    static int gcd(int a, int b) {
        while (b != 0) {
            int remainder = a % b;
            a = b;
            b = remainder;
        }
        return a;
    }

    /**
     * Punkt wejścia interpretera. Parametr {@code args} jest celowo nieużywany —
     * slot 0 ramki {@code main} trzyma wartownika, którego żadna instrukcja z §6 nie czyta.
     */
    public static void main(String[] args) {
        int result = gcd(1071, 462); // 21
    }
}
