// parsers/quickBooksParser.ts

import XLSX from "xlsx";
import { CanonicalTransaction } from "../types/CanonicalTransaction";

export function parseQuickBooks(
    path: string
): CanonicalTransaction[] {

    const workbook =
        XLSX.readFile(path);

    const sheet =
        workbook.Sheets[
        "Book Transactions"
        ];

    const rows =
        XLSX.utils.sheet_to_json(sheet);

    // TEMP DEBUG
    console.log(
        "\nQUICKBOOKS TRANSACTION TYPES"
    );

    console.log(
        rows.reduce(
            (
                acc: Record<
                    string,
                    number
                >,
                row: any
            ) => {

                const type =
                    String(
                        row.transaction_type ||
                        "UNKNOWN"
                    );

                acc[type] =
                    (acc[type] || 0) + 1;

                return acc;

            },
            {}
        )
    );

    return rows.map(
        (
            row: any
        ): CanonicalTransaction => {

            const txnType =
                String(
                    row.transaction_type ||
                    ""
                ).toLowerCase();

            let direction:
                "credit" |
                "debit";

            switch (txnType) {

                case "deposit":
                case "sales receipt":
                case "receive payment":
                case "invoice":
                    direction = "credit";
                    break;

                case "payment":
                case "bill payment":
                case "expense":
                case "check":
                    direction = "debit";
                    break;

                default:
                    direction = "debit";
            }

            return {

                id:
                    row.transaction_id,

                source:
                    "quickbooks",

                transactionDate:
                    new Date(
                        row.transaction_date
                    ),

                amount:
                    Number(
                        row.amount
                    ),

                direction,

                counterparty:
                    row.customer_vendor_name,

                referenceNumber:
                    row.reference_number,

                description:
                    row.memo,

                sourceId:
                    row.transaction_id,

                rawPayload:
                    row
            };
        }
    );
}