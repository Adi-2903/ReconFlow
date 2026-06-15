// parsers/bankParser.ts

import fs from "fs";
import csv from "csv-parser";

import { CanonicalTransaction }
    from "../types/CanonicalTransaction";

export async function parseBankCsv(
    path: string
): Promise<CanonicalTransaction[]> {

    const results: CanonicalTransaction[] = [];

    return new Promise<
        CanonicalTransaction[]
    >((resolve, reject) => {

        fs.createReadStream(path)
            .pipe(csv())

            .on("data", (row) => {

                results.push({
                    id:
                        row.bank_transaction_id,

                    source: "bank",

                    transactionDate:
                        new Date(
                            row.transaction_date
                        ),

                    amount:
                        Number(
                            row.amount
                        ),

                    direction:
                        row.direction
                            .toLowerCase(),

                    counterparty:
                        row.counterparty,

                    referenceNumber:
                        row.reference_number,

                    description:
                        row.narration,

                    sourceId:
                        row.bank_transaction_id,

                    rawPayload: row
                });
            })

            .on("end", () =>
                resolve(results)
            )

            .on("error", reject);
    });
}