export interface ExpectedMatch {
    match_id: string;

    match_type: string;

    bank_transaction_ids: string;

    book_transaction_ids: string;

    expected_confidence: string;

    explanation: string;
}