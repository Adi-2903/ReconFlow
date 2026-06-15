import fs from "fs";
import { parseStringPromise } from "xml2js";
import { randomUUID } from "crypto";

import type { BookTransaction } from "../types/BookTransaction";
import type { BookTransactionLine } from "../types/BookTransactionLine";

interface ParseResult {
    transactions: BookTransaction[];
    lines: BookTransactionLine[];
}

function normalizeVoucherType(
    voucherType: string
): string {
    const type =
        voucherType.toLowerCase();

    if (type.includes("receipt"))
        return "bank_receipt";

    if (type.includes("payment"))
        return "bank_payment";

    if (type.includes("journal"))
        return "journal_adjustment";

    if (type.includes("sales"))
        return "customer_invoice";

    if (type.includes("purchase"))
        return "vendor_bill";

    return "other";
}

function extractReference(
    narration?: string
): string | undefined {
    if (!narration) return undefined;

    const match =
        narration.match(/\d{6,}/);

    return match?.[0];
}

function parseDate(
    tallyDate?: string
): Date {
    if (!tallyDate) {
        return new Date(); // Fallback to current date or handle as needed
    }

    const year =
        tallyDate.slice(0, 4);

    const month =
        tallyDate.slice(4, 6);

    const day =
        tallyDate.slice(6, 8);

    return new Date(
        `${year}-${month}-${day}`
    );
}

export async function parseTallyFile(
    filePath: string
): Promise<ParseResult> {
    const xml =
        fs.readFileSync(
            filePath,
            "utf-8"
        );

    const parsed =
        await parseStringPromise(
            xml,
            {
                explicitArray: false,
                mergeAttrs: true
            }
        );

    const tallyMessages =
        parsed?.ENVELOPE?.BODY
            ?.IMPORTDATA
            ?.REQUESTDATA
            ?.TALLYMESSAGE;

    const messages =
        Array.isArray(
            tallyMessages
        )
            ? tallyMessages
            : [tallyMessages];

    const transactions: BookTransaction[] =
        [];

    const lines: BookTransactionLine[] =
        [];

    for (const message of messages) {

        const vouchers =
            Array.isArray(message?.VOUCHER)
                ? message.VOUCHER
                : message?.VOUCHER
                    ? [message.VOUCHER]
                    : [];

        for (const voucher of vouchers) {

            const transactionId =
                randomUUID();

            const voucherType =
                voucher.VOUCHERTYPENAME ||
                "Unknown";

            const narration =
                voucher.NARRATION || "";

            const rawEntries =
                voucher["ALLLEDGERENTRIES.LIST"] ||
                voucher["LEDGERENTRIES.LIST"] ||
                [];

            const ledgerEntries =
                Array.isArray(rawEntries)
                    ? rawEntries
                    : [rawEntries];

            let debitTotal = 0;
            let creditTotal = 0;
            let lineNumber = 1;

            for (const entry of ledgerEntries) {

                const ledgers =
                    Array.isArray(entry.LEDGERENTRY)
                        ? entry.LEDGERENTRY
                        : entry.LEDGERENTRY
                            ? [entry.LEDGERENTRY]
                            : [entry];

                for (const ledger of ledgers) {

                    const amount =
                        Number(
                            ledger.AMOUNT || 0
                        );

                    const debitAmount =
                        amount < 0
                            ? Math.abs(amount)
                            : 0;

                    const creditAmount =
                        amount > 0
                            ? amount
                            : 0;

                    debitTotal += debitAmount;
                    creditTotal += creditAmount;

                    lines.push({
                        id: randomUUID(),
                        transactionId,
                        lineNumber:
                            lineNumber++,
                        accountName:
                            ledger.LEDGERNAME || "",
                        partyName:
                            voucher.PARTYLEDGERNAME,
                        debitAmount,
                        creditAmount,
                        rawLedgerName:
                            ledger.LEDGERNAME
                    });
                }
            }

            transactions.push({
                id: transactionId,

                sourceSystem: "tally",

                sourceTransactionId:
                    voucher.REMOTEID ||
                    voucher.VOUCHERNUMBER ||
                    transactionId,

                transactionDate:
                    parseDate(
                        voucher.DATE
                    ),

                transactionTypeRaw:
                    voucherType,

                transactionTypeNormalized:
                    normalizeVoucherType(
                        voucherType
                    ),

                referenceNumber:
                    voucher.VOUCHERNUMBER,

                description:
                    narration,

                currency: "INR",

                lineCount:
                    lineNumber - 1,

                debitTotal,

                creditTotal,

                reconciliationAmount:
                    Math.max(
                        debitTotal,
                        creditTotal
                    ),

                isBalanced:
                    Math.abs(
                        debitTotal -
                        creditTotal
                    ) < 0.01,

                rawPayload:
                    voucher
            });
        }
    }

    return {
        transactions,
        lines
    };
}