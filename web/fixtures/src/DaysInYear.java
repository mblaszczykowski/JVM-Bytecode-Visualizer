/**
 * A {@code switch} over dense case labels, which javac compiles to {@code tableswitch}: the
 * instruction subtracts the low label from the value and indexes straight into a jump table, so all
 * twelve calls reach their arm in the same number of steps. The table spans the labels 2 to 11, ten
 * entries for five cases: the four thirty-day months share one target, the months absent from the
 * table (3, 5, 7, 8 and 10) hold the default target, and so do 1 and 12, which fall outside its
 * range. The total, 365, is left in the local variable {@code result}.
 */
public final class DaysInYear {

    private DaysInYear() {}

    /**
     * Length of a month in a common (non-leap) year.
     *
     * @param month the month, numbered 1 to 12
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

    /** Adds up the twelve months; a common year comes to 365 days. */
    static int daysInYear() {
        int days = 0;
        for (int month = 1; month <= 12; month++) {
            days += daysInMonth(month);
        }
        return days;
    }

    /**
     * Entry point. {@code args} is unused: slot 0 of the frame holds a sentinel that no supported
     * instruction can read.
     */
    public static void main(String[] args) {
        int result = daysInYear(); // 365
    }
}
