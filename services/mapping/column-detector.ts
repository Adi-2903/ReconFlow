export function detectColumns(headers: string[]): Record<string, string> {
  const result: Record<string, string> = {
    date: "",
    description: "",
    amount: "",
    debit: "",
    credit: "",
    reference: "",
  };

  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ");

  const dateRegex = /date|time|txn|value|created/i;
  const descRegex = /desc|narrat|particular|memo|details/i;
  const amountRegex = /^amount|amount$|total|net/i;
  const debitRegex = /debit|withdrawal|outflow|payment|paid/i;
  const creditRegex = /credit|deposit|inflow|receipt|received/i;
  const refRegex = /ref|reference|id|doc|num|vch/i;

  headers.forEach((header) => {
    const h = clean(header);
    if (!result.date && dateRegex.test(h)) {
      result.date = header;
    } else if (!result.description && descRegex.test(h)) {
      result.description = header;
    } else if (debitRegex.test(h)) {
      result.debit = header;
    } else if (creditRegex.test(h)) {
      result.credit = header;
    } else if (!result.amount && amountRegex.test(h)) {
      result.amount = header;
    } else if (!result.reference && refRegex.test(h)) {
      result.reference = header;
    }
  });

  // If we found debit/credit, we don't necessarily need a single amount column
  if (result.debit && result.credit && !result.amount) {
    result.amount = `${result.debit}/${result.credit}`;
  }

  return result;
}
