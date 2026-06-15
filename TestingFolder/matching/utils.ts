// matching/utils.ts

import { CanonicalTransaction } from "../types/CanonicalTransaction";

export function normalizeReference(
    ref?: string
): string {
    if (!ref) return "";

    return ref
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}

export function normalizeName(
    name?: string
): string {
    if (!name) return "";

    return name
        .toUpperCase()
        .replace(
            /\b(CORPORATION|CORP|PVT|PRIVATE|LTD|LIMITED|SOLUTIONS|SOLUTION)\b/g,
            ""
        )
        .replace(/[^A-Z0-9]/g, "");
}

export function daysBetween(
    a: Date,
    b: Date
): number {
    return Math.abs(
        (
            a.getTime() -
            b.getTime()
        ) / 86400000
    );
}

export function referenceMatches(
    bankRef?: string,
    bookRef?: string
): boolean {
    const a =
        normalizeReference(bankRef);

    const b =
        normalizeReference(bookRef);

    if (!a || !b)
        return false;

    return (
        a === b ||
        a.includes(b) ||
        b.includes(a)
    );
}

export function nameMatches(
    bank?: string,
    book?: string
): boolean {
    const a =
        normalizeName(bank);

    const b =
        normalizeName(book);

    if (!a || !b)
        return false;

    return (
        a === b ||
        a.includes(b) ||
        b.includes(a)
    );
}

export function directionMatches(
    a: CanonicalTransaction,
    b: CanonicalTransaction
): boolean {
    return a.direction === b.direction;
}