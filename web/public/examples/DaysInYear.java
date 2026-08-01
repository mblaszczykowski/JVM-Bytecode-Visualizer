/**
 * The length of a year, month by month — the example built around a {@code switch}.
 *
 * <p>A {@code switch} over dense labels does not compare the value against one case after
 * another: javac lays the arms out as a jump table and emits {@code tableswitch}, which
 * subtracts the low label from the value and indexes straight into that table. Twelve calls
 * therefore reach six different arms in exactly the same number of steps.
 *
 * <p>The table is worth reading as it is resolved. It spans the labels 2 to 11, so it has ten
 * entries for five cases: the four thirty-day months share one target, the months that are
 * simply absent from the table (3, 5, 7, 8 and 10) hold the default target, and so do 1 and
 * 12, which fall outside the range of the table altogether.
 *
 * <p>There is no {@code System.out.println} and no static field; the result — 365 — is stored
 * in the local variable {@code result}.
 */
public final class DaysInYear {

    private DaysInYear() {
        // Utility class — never instantiated.
    }

    /**
     * Length of a month in a common (non-leap) year.
     *
     * @param month the month, numbered 1 to 12
     * @return the number of days in that month
     */
    static int daysInMonth(int month) {
        switch (month) {
            case 2:
                return 28;
            case 4:
            case 6:
            case 9:
            case 11:
                return 30;
            default:
                return 31;
        }
    }

    /**
     * Adds up the twelve months.
     *
     * @return the number of days in a common year, i.e. 365
     */
    static int daysInYear() {
        int days = 0;
        for (int month = 1; month <= 12; month++) {
            days += daysInMonth(month);
        }
        return days;
    }

    /**
     * Interpreter entry point. The {@code args} parameter is deliberately unused — slot 0 of
     * the {@code main} frame holds a sentinel that no supported instruction can read.
     */
    public static void main(String[] args) {
        int result = daysInYear(); // 365
    }
}
