/**
 * Harness fazy 4: liczy wyniki referencyjne przykładów na PRAWDZIWEJ JVM.
 *
 * <p>Wypisuje po jednej linii {@code <id>=<wartość>} na przykład; {@code build-fixtures.mjs}
 * parsuje to wyjście i zapisuje wartości jako {@code expectedResult} w {@code manifest.json}.
 * To one napędzają test różnicowy interpretera (plan.md §7): interpreter musi zwrócić
 * dokładnie to, co zwróciła prawdziwa JVM — nie to, co wpisał człowiek.
 *
 * <p>Ten plik NIE jest kopiowany do {@code public/examples} — nie jest przykładem do
 * wizualizacji, tylko narzędziem builda. Może więc bez skrupułów używać {@code System.out},
 * którego przykłady używać nie mogą (plan.md §5.4).
 *
 * <p><strong>Uwaga na synchronizację:</strong> argumenty poniżej muszą być identyczne
 * z tymi w metodach {@code main} przykładów — inaczej {@code expectedResult} w manifeście
 * opisywałby inne wykonanie niż to, które odtwarza interpreter.
 */
public final class ExpectedResults {

    private ExpectedResults() {
        // Klasa narzędziowa — instancji nie tworzymy.
    }

    public static void main(String[] args) {
        System.out.println("factorial=" + Factorial.factorial(4));
        System.out.println("fibonacci=" + Fibonacci.fib(7));
        System.out.println("sum-of-squares=" + SumOfSquares.sumOfSquares(6));
        System.out.println("gcd=" + Gcd.gcd(1071, 462));
    }
}
