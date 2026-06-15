// types/Match.ts

export type MatchType =
    | "exact"
    | "near"
    | "fee_adjustment"
    | "one_to_many"
    | "many_to_one";

export interface Match {
    bankTransactionIds: string[];
    bookTransactionIds: string[];

    score: number;

    matchType: MatchType;

    explanation?: string;
}