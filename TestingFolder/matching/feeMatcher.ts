// matching/feeMatcher.ts

export function isFeeAdjustment(
    bankAmount: number,
    bookAmount: number
): boolean {

    const diff =
        Math.abs(
            bookAmount -
            bankAmount
        );

    return (
        diff >= 50 &&
        diff <= 500
    );
}