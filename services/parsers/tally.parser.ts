import { parseStringPromise } from "xml2js";

export async function parseTallyXml(content: string): Promise<string[][]> {
  // 1. XXE Security Check
  if (content.includes("<!DOCTYPE") || content.includes("<!ENTITY")) {
    throw new Error("XXE Security Violation: XML files containing external entity declarations (DOCTYPE/ENTITY) are not allowed.");
  }

  try {
    const result = await parseStringPromise(content);
    const envelope = result.ENVELOPE;
    if (!envelope || !envelope.BODY || !envelope.BODY[0].IMPORTDATA || !envelope.BODY[0].IMPORTDATA[0].REQUESTDATA) {
      throw new Error("Invalid Tally XML structure.");
    }

    const tallyMessage = envelope.BODY[0].IMPORTDATA[0].REQUESTDATA[0].TALLYMESSAGE[0];
    const vouchers = tallyMessage.VOUCHER || [];

    const rows: string[][] = [
      ["Date", "Voucher No", "Party Ledger Name", "Narration", "Voucher Type", "Ledger Entries"]
    ];

    for (const v of vouchers) {
      const dateVal = v.DATE ? String(v.DATE[0]).trim() : "";
      let formattedDate = dateVal;
      if (dateVal.length === 8) {
        formattedDate = `${dateVal.substring(0, 4)}-${dateVal.substring(4, 6)}-${dateVal.substring(6, 8)}`;
      }

      const voucherNoVal = v.VOUCHERNUMBER ? String(v.VOUCHERNUMBER[0]).trim() : "";
      const partyLedgerNameVal = v.PARTYLEDGERNAME ? String(v.PARTYLEDGERNAME[0]).trim() : "";
      const narrationVal = v.NARRATION ? String(v.NARRATION[0]).trim() : "";
      const voucherTypeVal = v.VOUCHERTYPENAME ? String(v.VOUCHERTYPENAME[0]).trim() : "";

      // Extract raw ledger entries list
      const ledgerEntries: { ledgerName: string; amount: number; isDeemedPositive: boolean }[] = [];
      const ledgerEntriesList = v["ALLLEDGERENTRIES.LIST"];

      if (ledgerEntriesList && ledgerEntriesList[0] && ledgerEntriesList[0].LEDGERENTRY) {
        const entries = ledgerEntriesList[0].LEDGERENTRY;
        for (const entry of entries) {
          const ledgerName = entry.LEDGERNAME ? String(entry.LEDGERNAME[0]).trim() : "";
          const amountVal = entry.AMOUNT ? String(entry.AMOUNT[0]).trim() : "0";
          const isDeemedPositiveVal = entry.ISDEEMEDPOSITIVE ? String(entry.ISDEEMEDPOSITIVE[0]).trim() : "No";

          ledgerEntries.push({
            ledgerName,
            amount: parseFloat(amountVal) || 0,
            isDeemedPositive: isDeemedPositiveVal.toLowerCase() === "yes",
          });
        }
      }

      rows.push([
        formattedDate,
        voucherNoVal,
        partyLedgerNameVal,
        narrationVal,
        voucherTypeVal,
        JSON.stringify(ledgerEntries),
      ]);
    }

    return rows;
  } catch (error: any) {
    if (error.message.includes("XXE Security Violation")) {
      throw error;
    }
    throw new Error(`Tally XML Parsing failed: ${error.message}`);
  }
}
