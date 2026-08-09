import java.io.OutputStream;
import java.io.PrintStream;
import java.util.function.IntSupplier;

public final class ExpectedResults {

    private ExpectedResults() {}

    public static void main(String[] args) {
        System.out.println("factorial=" + quietly(() -> Factorial.factorial(4)));
        System.out.println("fibonacci=" + quietly(() -> Fibonacci.fib(7)));
        System.out.println("sum-of-products=" + quietly(() -> SumOfProducts.sumOfProducts(6)));
        System.out.println("gcd=" + quietly(() -> Gcd.gcd(1071, 462)));
        System.out.println("bubble-sort=" + quietly(BubbleSort::sortedMinimum));
        System.out.println("collatz=" + quietly(() -> Collatz.stepsToOne(7)));
        System.out.println("days-in-year=" + quietly(DaysInYear::daysInYear));
        System.out.println("fast-power=" + quietly(() -> FastPower.power(3, 13)));
    }

    private static int quietly(IntSupplier computation) {
        PrintStream stdout = System.out;
        System.setOut(new PrintStream(OutputStream.nullOutputStream()));
        try {
            return computation.getAsInt();
        } finally {
            System.setOut(stdout);
        }
    }
}
