# ReconFlow Test Data Pack — README

This is a synthetic but realistic dataset for one fictional company, **Bluepeak Studios Private
Limited**, covering January 2026. It's built to stress-test all 7 phases of your pipeline, not just
the matching engine. Everything ties out exactly (every paisa), so any mismatch you see is a real
parser/engine gap, not a fixture bug.

## Files

```
01_bank_statements/
  HDFC_Bluepeak_CurrentAC_Jan2026.csv      <- PRIMARY bank file, 51 txns, deliberately messy
  ICICI_Bluepeak_Savings_Jan2026.xlsx      <- parsing-only, multi-sheet, no ledger pair
  SBI_Bluepeak_OldCurrentAC_Jan2026.csv    <- SECONDARY bank file, pairs with Tally below

02_payment_processor/
  Stripe_Balance_Itemized_Jan2026.csv      <- real Stripe itemized-report schema

03_accounting_ledger/
  QuickBooks_Invoices_Bills_Export_Jan2026.csv   <- PRIMARY ledger, pairs with HDFC
  Tally_Ledger_Voucher_Export.xlsx               <- SECONDARY ledger, pairs with SBI

ground_truth.json                          <- machine-readable expected outcomes for every scenario
_generator_scripts/                        <- the Python that built all of this, in case you want
                                               to add more scenarios later (single source of truth
                                               is _build_scenarios.py)
```

## How to use this

1. Run the full pipeline (ingest → clean → map → match → classify) against the **primary pair**
   (HDFC + QuickBooks + Stripe).
2. Compare your output against `ground_truth.json` → `primary_pair.matching_scenarios`. Every
   scenario has an `id` (e.g. `F6`), the pass it should land in, the expected confidence band
   (`outcome`), and any discrepancy tags it should pick up.
3. Then run the **secondary pair** (SBI + Tally) as an independent check that your schema mapper
   generalizes beyond the exact column names you built it against, not just the primary pair.
4. The ICICI file is parsing-only — feed it through ingestion/cleaning/mapping and manually check
   the output looks right. No matching is expected since there's no ledger counterpart.

Every transaction narration in the primary pair is prefixed with its scenario ID (e.g.
`F6 TEST | STRIPE TRANSFER ch_3Pjk88 | Meridian Apps Inc`) so you can `grep` for it while debugging.
Strip that prefix mentally — real bank narrations obviously won't have it, but it makes wiring up
assertions painless.

## What's covered, by pipeline phase

### Phase 1–2: Ingestion & Cleaning (8 deliberate artifacts, all inside the HDFC file)
| ID | Issue |
|---|---|
| C1 | Exact duplicate row (same amount/date/ref appears twice) |
| C2 | Both withdrawal and deposit blank on one row |
| C3 | Date field blank |
| C4 | Negative number sitting in the deposit column (export glitch) |
| C5 | Year typo'd as 2027 instead of 2026 (future-dated) |
| C6 | Amount cell contains `"Rs. 9,450.00"` as text instead of a clean number |
| C7 | Narration has leading/trailing/double spaces plus a non-breaking space (`\xa0`) |
| C8 | ₹ symbol corrupted to mojibake (`â‚¹`) — classic bad PDF→CSV re-encoding artifact |

### Phase 3: Universal Schema Mapper
- **HDFC**: 5 letterhead rows before the real header; account number/branch/IFSC crammed into one
  comma-separated line.
- **ICICI**: two sheets (a `Summary` sheet that must be ignored, and `Transactions` with its own
  letterhead *and* a stray `"Page 1 of 1"` row injected mid-table); different column names
  (`Transaction Remarks`, `Withdrawal Amount (INR)`); dates as `DD-Mon-YYYY`.
- **SBI**: yet another column vocabulary (`Txn Date`, `Ref No./Cheque No.`); 2-digit year dates
  (`DD/MM/YY`).
- **QuickBooks**: `TxnDate`, `CustomerVendorRef`, `TotalAmt` — and see the date-format trap below.
- **Tally**: completely different vocabulary again (`Voucher Type`, `Particulars`, `Debit Amount`).
- **The MM/DD trap**: every QuickBooks date in this file is `01/DD/YYYY`. Because month is always
  `01`, a mapper that assumes DD/MM (the Indian default) instead of detecting the file's actual
  convention will silently shift every single ledger transaction to the wrong month. This won't
  throw an error — it'll just quietly produce wrong "timing difference" classifications across the
  entire ledger. Worth asserting against explicitly.

### Phase 4: Matching Engine
- **Pass 1 (exact)**: E1–E4, plus the whole SBI/Tally secondary set.
- **Pass 2 (bulk/subset-sum)**: B1 (3-invoice NEFT), B2 (4-charge Stripe payout net of fees), B3
  (2-invoice wire at the exact 5-day window edge).
- **Pass 3 (fuzzy)**: F1–F10, covering every discrepancy category your README lists, plus three
  explicit **boundary tests**:
  - F8 — 6-day date gap (inside the "acceptable with lower score" 3–7 day band)
  - F9a — 4.8% amount difference (just under your 5% "acceptable with note" line)
  - F9b — 19.5% amount difference (just under your 20% rejection line)

  These three exist specifically to catch off-by-one errors in your threshold comparisons
  (`<=` vs `<`, `0.05` vs `5`, etc.) — the kind of bug that only shows up at the edges.
- **Pass 4 (exceptions)**: X1 (bank credit with no ledger counterpart at all — interest income),
  X2 (ledger invoice with no bank txn — genuinely unpaid), X3 (same-day/same-counterparty but 35%
  amount gap — must be rejected despite text/date similarity), X5 (NEFT credit reversed the next
  day — must not be auto-matched as paid revenue).
- **Collision case**: X4a/X4b — identical amount, date, and counterparty but two genuinely
  different invoices with two different bank reference numbers. Tests whether your engine uses the
  reference number (or some other disambiguator) instead of just `(amount, date, counterparty)`,
  which would either double-link one bank row to both invoices or drop one silently.

### Phase 5: Discrepancy Classification
Every Pass 2/3 scenario is tagged with the discrepancy category it should land in: timing
difference (F1, F8), partial payment (F2), typo — reference (F3) and vendor name (F4), FX rate
movement (F5), hidden processing fee — Stripe (B2, F6) and flat bank wire charge (F7), plus a
rounding-only case (F10) that's arguably not a "discrepancy" at all and might deserve its own
auto-approve fast path.

### Phase 6/7: AI Reasoning & Human Review Queue
Once Pass 3/4 items are classified, feed F1–X5 through your Gemini/Claude reasoning layer and check
the explanations actually name the right cause — e.g. F6 should come back identifying a Stripe fee,
not a generic "partial payment," and F2 (genuine partial payment) should *not* get a fee
explanation invented for it just because F6 looks similar in shape.

## Gaps I noticed in your pipeline design while building this

Worth a look regardless of how the test data performs:

1. **Header-offset detection isn't mentioned in Phase 3.** Every bank in this pack puts a different
   number of letterhead rows before the real table. If your mapper assumes "skip N rows" rather
   than detecting the header row by content (e.g. first row where most cells parse as expected
   types), it'll break the moment a statement is one line longer/shorter than your sample.
2. **No explicit locale/date-format detection step.** Four different date conventions appear here
   (`DD/MM/YYYY`, `DD-Mon-YYYY`, `DD/MM/YY`, `MM/DD/YYYY`) across just 5 files. Detecting this
   **once per file** (not per-row) and applying it consistently is the only way to avoid the QBO
   trap above.
3. **Encoding/whitespace normalization isn't called out as its own step.** C7/C8 are common
   results of PDF→CSV conversion tools (which your own README's local dev setup doesn't mention as
   a possible upstream source, but in practice many users will upload PDF-derived CSVs). A
   `.strip()` + Unicode-normalize (NFKC) pass before anything else would catch most of this.
4. **Reversed/returned transactions aren't mentioned anywhere in Phase 2 or Phase 4.** X5 — a NEFT
   that bounces back the next day — is common enough in Indian banking (wrong account details,
   beneficiary name mismatch) that it probably deserves explicit handling: net same-counterparty
   opposite-sign transactions within a short window before they ever reach the matching engine.
5. **Fee detection logic is described in Phase 5/6 but not in the Phase 4 scoring itself.** As
   written, a Stripe-fee transaction (B2, F6) would first need to survive Pass 3's amount-similarity
   filter (which only tolerates 0.5–5%, and a 2.9%+flat-fee deduction can exceed that on small
   invoices) before it ever reaches the fee-aware AI layer. You may want either a wider tolerance
   band specifically for known payment-processor counterparties, or a dedicated pre-pass that
   checks "is this amount explainable by a known fee formula" before the generic fuzzy scorer
   rejects it outright.
6. **Currency conversion timing isn't specified.** F5 tests whether you use the booking-date rate,
   the settlement-date rate, or compare both — your README says "pull the exchange rate for that
   date" without saying *which* date when the invoice and bank settlement dates differ.

Happy to build a second batch (multi-currency-heavy, or a much higher-volume stress test for
performance) once you've run this one and seen where it actually breaks.
