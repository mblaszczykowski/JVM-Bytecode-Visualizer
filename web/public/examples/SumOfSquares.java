/**
 * Zagnieżdżone pętle {@code for} — przykład bez rekurencji, za to z płaskim stosem
 * i długą historią wykonania.
 *
 * <p>Suma iloczynów {@code i * j} po kwadratowej siatce {@code n x n}; na przekątnej
 * ({@code i == j}) składnikami są kolejne kwadraty, stąd nazwa przykładu.
 * Dla {@code n = 6} siatka ma 36 pól, co daje ok. 470 kroków bajtkodu — wystarczająco
 * dużo, by zobaczyć w akcji {@code iinc} (inkrementacja licznika w miejscu, bez stosu
 * operandów), {@code if_icmpgt} (warunek pętli) i skok wsteczny {@code goto}.
 *
 * <p>Program mieści się w podzbiorze instrukcji z plan.md §6 i respektuje ograniczenia §5.4
 * (bez {@code System.out.println}, bez pól statycznych, wynik do lokalnej {@code result}).
 */
public final class SumOfSquares {

    private SumOfSquares() {
        // Klasa narzędziowa — instancji nie tworzymy.
    }

    /**
     * Sumuje iloczyny {@code i * j} dla wszystkich par z zakresu {@code 1..n}.
     *
     * @param n rozmiar boku siatki; dla {@code n <= 0} pętle nie wykonują ani jednego obrotu
     * @return suma wszystkich iloczynów, czyli kwadrat n-tej liczby trójkątnej
     */
    static int sumOfSquares(int n) {
        int sum = 0;
        for (int i = 1; i <= n; i++) {
            for (int j = 1; j <= n; j++) {
                sum += i * j;
            }
        }
        return sum;
    }

    /**
     * Punkt wejścia interpretera. Parametr {@code args} jest celowo nieużywany —
     * slot 0 ramki {@code main} trzyma wartownika, którego żadna instrukcja z §6 nie czyta.
     */
    public static void main(String[] args) {
        int result = sumOfSquares(6); // 441
    }
}
