/**
 * Bubble sort, the one example that puts an array on the heap. {@code {5, 3, 4, 1, 2}} is
 * allocated with {@code newarray}, filled element by element with {@code iastore} and then sorted
 * in place: each pass walks the array with {@code iaload}, compares neighbours and swaps them, so
 * the largest remaining value moves to the end. The inner bound shrinks by one per pass and is
 * re-read from {@code arraylength} every time; the result is left in the local variable
 * {@code result}.
 */
public final class BubbleSort {

    private BubbleSort() {}

    /**
     * Sorts a fixed five-element array in place and reports its smallest element.
     *
     * <p>Only {@code int} parameters and an {@code int}/{@code void} return type are supported, so
     * the array is built here rather than passed in, and the caller gets back one element of it.
     *
     * @return {@code a[0]} after sorting, i.e. the minimum of the array, 1; the unsorted array
     *     starts with 5, so the value shows the sort ran
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
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = sortedMinimum(); // 1
    }
}
