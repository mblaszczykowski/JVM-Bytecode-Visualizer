/**
 * Bubble sort — the example that puts an array on the heap.
 *
 * <p>{@code {5, 3, 4, 1, 2}} is allocated with {@code newarray} and filled element by element
 * with {@code iastore}, then sorted in place: each pass walks the array with {@code iaload},
 * compares neighbours and swaps them, so the largest value left over bubbles to the end.
 *
 * <p>Two nested {@code for} loops, an inner bound that shrinks by one per pass and is read
 * back from {@code arraylength} every time, and a few hundred steps in which the array on the
 * heap changes with every swap — the local variables alone no longer tell the whole story.
 *
 * <p>There is no {@code System.out.println} and no static field; the result is stored in the
 * local variable {@code result}.
 */
public final class BubbleSort {

    private BubbleSort() {
        // Utility class — never instantiated.
    }

    /**
     * Sorts a fixed five-element array in place and reports its smallest element.
     *
     * <p>The array is neither a parameter nor a return value: only {@code int} parameters and
     * an {@code int}/{@code void} return type are supported, so the data is built here and the
     * caller gets a single element of the sorted array back.
     *
     * @return {@code a[0]} after sorting, i.e. the minimum of the array — 5 before the sort
     *     runs, so the value proves that it did
     */
    static int sortedMinimum() {
        int[] a = {5, 3, 4, 1, 2};
        for (int i = 0; i < a.length - 1; i++) {
            // After i passes the last i elements are the largest ones, already in place.
            for (int j = 0; j < a.length - 1 - i; j++) {
                if (a[j] > a[j + 1]) {
                    int swap = a[j];
                    a[j] = a[j + 1];
                    a[j + 1] = swap;
                }
            }
        }
        return a[0];
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = sortedMinimum(); // 1
    }
}
