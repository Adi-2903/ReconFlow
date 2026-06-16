import { db } from "@/core/db";
import { users, ledgerEntries } from "@/core/db/schema";
import { eq } from "drizzle-orm";
import OAuthClient from "intuit-oauth";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QboSyncResult {
  count: number;
  message: string;
  breakdown: {
    invoices: number;
    payments: number;
    bills: number;
    creditMemos: number;
    deposits: number;
    journalEntries: number;
    purchases: number;
  };
}

export interface QboDisconnectResult {
  success: boolean;
}

// ─── QBO API helpers ──────────────────────────────────────────────────────────

function getBaseUrl(client: OAuthClient): string {
  return client.environment === "sandbox"
    ? OAuthClient.environment.sandbox
    : OAuthClient.environment.production;
}

async function qboQuery(client: OAuthClient, realmId: string, query: string): Promise<any[]> {
  const base = getBaseUrl(client);
  const url = `${base}v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const response = await client.makeApiCall({ url, method: "GET" });

  const body =
    typeof (response as any).json === "function"
      ? await (response as any).json()
      : (response as any).data;

  return body?.QueryResponse ?? {};
}

// ─── Entity → ledgerEntry mappers (backend engineer owns these) ───────────────

function mapInvoices(items: any[], userId: string) {
  return items.map((inv) => ({
    userId,
    amount: Math.round(Number(inv.TotalAmt) * 100).toString(),
    date: inv.TxnDate || new Date().toISOString().split("T")[0],
    memo: inv.CustomerRef?.name
      ? `Invoice #${inv.DocNumber} — ${inv.CustomerRef.name}`
      : `Invoice #${inv.DocNumber}`,
    invoiceRef: inv.DocNumber || inv.Id,
    accountCode: "INVOICE",
    status: "unmatched",
  }));
}

function mapPayments(items: any[], userId: string) {
  return items.map((pmt) => ({
    userId,
    amount: Math.round(Number(pmt.TotalAmt) * 100).toString(),
    date: pmt.TxnDate || new Date().toISOString().split("T")[0],
    memo: pmt.CustomerRef?.name ? `Payment from ${pmt.CustomerRef.name}` : `Payment #${pmt.Id}`,
    invoiceRef: pmt.Id,
    accountCode: "PAYMENT",
    status: "unmatched",
  }));
}

function mapBills(items: any[], userId: string) {
  return items.map((bill) => ({
    userId,
    amount: (-Math.round(Number(bill.TotalAmt) * 100)).toString(), // outgoing = negative
    date: bill.TxnDate || new Date().toISOString().split("T")[0],
    memo: bill.VendorRef?.name ? `Bill to ${bill.VendorRef.name}` : `Bill #${bill.Id}`,
    invoiceRef: bill.DocNumber || bill.Id,
    accountCode: "BILL",
    status: "unmatched",
  }));
}

function mapCreditMemos(items: any[], userId: string) {
  return items.map((cm) => ({
    userId,
    amount: (-Math.round(Number(cm.TotalAmt) * 100)).toString(),
    date: cm.TxnDate || new Date().toISOString().split("T")[0],
    memo: cm.CustomerRef?.name
      ? `Credit Memo #${cm.DocNumber} — ${cm.CustomerRef.name}`
      : `Credit Memo #${cm.DocNumber}`,
    invoiceRef: cm.DocNumber || cm.Id,
    accountCode: "CREDIT_MEMO",
    status: "unmatched",
  }));
}

function mapDeposits(items: any[], userId: string) {
  return items.map((dep) => ({
    userId,
    amount: Math.round(Number(dep.TotalAmt) * 100).toString(),
    date: dep.TxnDate || new Date().toISOString().split("T")[0],
    memo: `Bank Deposit — ${dep.DepositToAccountRef?.name || dep.Id}`,
    invoiceRef: dep.Id,
    accountCode: "DEPOSIT",
    status: "unmatched",
  }));
}

function mapJournalEntries(items: any[], userId: string) {
  return items.flatMap((je: any) => {
    const lines: any[] = je.Line || [];
    return lines.map((line) => {
      const detail = line.JournalEntryLineDetail || {};
      const rawAmt = Number(line.Amount || 0);
      const amount =
        detail.PostingType === "Debit" ? Math.round(rawAmt * 100) : -Math.round(rawAmt * 100);
      return {
        userId,
        amount: amount.toString(),
        date: je.TxnDate || new Date().toISOString().split("T")[0],
        memo: line.Description || `Journal Entry #${je.DocNumber || je.Id}`,
        invoiceRef: `JE-${je.DocNumber || je.Id}`,
        accountCode: detail.AccountRef?.name || "JOURNAL",
        status: "unmatched",
      };
    });
  });
}

function mapPurchases(items: any[], userId: string) {
  return items.map((pur) => ({
    userId,
    amount: (-Math.round(Number(pur.TotalAmt) * 100)).toString(), // outgoing = negative
    date: pur.TxnDate || new Date().toISOString().split("T")[0],
    memo: pur.EntityRef?.name ? `Purchase — ${pur.EntityRef.name}` : `Purchase #${pur.Id}`,
    invoiceRef: pur.DocNumber || pur.Id,
    accountCode: "PURCHASE",
    status: "unmatched",
  }));
}

// ─── Service functions ────────────────────────────────────────────────────────

export async function syncQboData(
  userId: string,
  appBaseUrl: string
): Promise<QboSyncResult> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  if (!user?.qboAccessToken || !user.qboRealmId) {
    throw Object.assign(new Error("QuickBooks is not connected"), { statusCode: 400 });
  }

  const oauthClient = new OAuthClient({
    clientId: process.env.QBO_CLIENT_ID as string,
    clientSecret: process.env.QBO_CLIENT_SECRET as string,
    environment: (process.env.QBO_ENVIRONMENT || "sandbox") as any,
    redirectUri: `${appBaseUrl}/api/qbo/callback`,
  });

  oauthClient.setToken({
    access_token: user.qboAccessToken,
    refresh_token: user.qboRefreshToken || "",
    realmId: user.qboRealmId as string,
  });

  // Auto-refresh if token expires within 5 minutes
  if (user.qboTokenExpiresAt && new Date() > new Date(user.qboTokenExpiresAt.getTime() - 5 * 60_000)) {
    try {
      const authResponse = await oauthClient.refresh();
      const tokenData = authResponse.getJson();
      const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
      await db.update(users).set({
        qboAccessToken: tokenData.access_token,
        qboRefreshToken: tokenData.refresh_token,
        qboTokenExpiresAt: expiresAt,
      }).where(eq(users.id, userId));
    } catch (refreshErr) {
      throw Object.assign(
        new Error("QuickBooks session expired. Please reconnect."),
        { statusCode: 401 }
      );
    }
  }

  const realmId = user.qboRealmId;
  const MAX = 100;

  // Fetch all 7 entity types in parallel (one failure doesn't stop the rest)
  const [
    invoiceResp, paymentResp, billResp,
    creditMemoResp, depositResp, journalEntryResp, purchaseResp,
  ] = await Promise.allSettled([
    qboQuery(oauthClient, realmId, `select * from Invoice maxresults ${MAX}`),
    qboQuery(oauthClient, realmId, `select * from Payment maxresults ${MAX}`),
    qboQuery(oauthClient, realmId, `select * from Bill maxresults ${MAX}`),
    qboQuery(oauthClient, realmId, `select * from CreditMemo maxresults ${MAX}`),
    qboQuery(oauthClient, realmId, `select * from Deposit maxresults ${MAX}`),
    qboQuery(oauthClient, realmId, `select * from JournalEntry maxresults ${MAX}`),
    qboQuery(oauthClient, realmId, `select * from Purchase maxresults ${MAX}`),
  ]);

  const extract = (result: PromiseSettledResult<any>, key: string): any[] => {
    if (result.status === "fulfilled") return result.value[key] || [];
    console.warn(`QBO fetch failed for ${key}:`, (result as any).reason?.message);
    return [];
  };

  const invoices       = extract(invoiceResp,      "Invoice");
  const payments       = extract(paymentResp,      "Payment");
  const bills          = extract(billResp,         "Bill");
  const creditMemos    = extract(creditMemoResp,   "CreditMemo");
  const deposits       = extract(depositResp,      "Deposit");
  const journalEntries = extract(journalEntryResp, "JournalEntry");
  const purchases      = extract(purchaseResp,     "Purchase");

  const allEntries = [
    ...mapInvoices(invoices, userId),
    ...mapPayments(payments, userId),
    ...mapBills(bills, userId),
    ...mapCreditMemos(creditMemos, userId),
    ...mapDeposits(deposits, userId),
    ...mapJournalEntries(journalEntries, userId),
    ...mapPurchases(purchases, userId),
  ];

  if (allEntries.length === 0) {
    return {
      count: 0,
      message: "No transactions found in QuickBooks for any entity type",
      breakdown: { invoices: 0, payments: 0, bills: 0, creditMemos: 0, deposits: 0, journalEntries: 0, purchases: 0 },
    };
  }

  await db.insert(ledgerEntries).values(allEntries);
  await db.update(users).set({ qboLastSync: new Date() }).where(eq(users.id, userId));

  return {
    count: allEntries.length,
    message: "Sync successful",
    breakdown: {
      invoices: invoices.length,
      payments: payments.length,
      bills: bills.length,
      creditMemos: creditMemos.length,
      deposits: deposits.length,
      journalEntries: journalEntries.length,
      purchases: purchases.length,
    },
  };
}

export async function disconnectQbo(userId: string): Promise<QboDisconnectResult> {
  await db.update(users).set({
    qboAccessToken: null,
    qboRefreshToken: null,
    qboRealmId: null,
    qboTokenExpiresAt: null,
  }).where(eq(users.id, userId));

  return { success: true };
}
