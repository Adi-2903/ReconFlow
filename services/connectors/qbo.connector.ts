import { db } from "@/core/db";
import { connectors as dbConnectors, financialAccounts, canonicalTransactions, counterpartyProfiles } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";
import OAuthClient from "intuit-oauth";
import { Connector, NormalizedConnectorRecord } from "./connector.interface";

export class QboConnector implements Connector {
  private getOAuthClient(appBaseUrl: string): OAuthClient {
    return new OAuthClient({
      clientId: process.env.QBO_CLIENT_ID as string,
      clientSecret: process.env.QBO_CLIENT_SECRET as string,
      environment: (process.env.QBO_ENVIRONMENT || "sandbox") as any,
      redirectUri: `${appBaseUrl}/api/qbo/callback`,
    });
  }

  async connect(userId: string, orgId: string, accountId: string, params?: any): Promise<any> {
    // connect logic can return the QBO OAuth authorization URL
    const oauthClient = this.getOAuthClient(params?.appBaseUrl || "http://localhost:3000");
    const authUri = oauthClient.authorizeUri({
      scope: [
        OAuthClient.scopes.Accounting,
        OAuthClient.scopes.OpenId
      ],
      state: `${userId}:${orgId}:${accountId}`,
    });
    return { authUri };
  }

  async disconnect(userId: string, orgId: string, accountId: string): Promise<any> {
    await db
      .update(dbConnectors)
      .set({
        accessToken: null,
        refreshToken: null,
        tokenExpiresAt: null,
        status: "disconnected",
      })
      .where(
        and(
          eq(dbConnectors.organizationId, orgId),
          eq(dbConnectors.accountId, accountId)
        )
      );
    return { success: true };
  }

  async sync(userId: string, orgId: string, accountId: string, params?: any): Promise<NormalizedConnectorRecord[]> {
    const [conn] = await db
      .select()
      .from(dbConnectors)
      .where(
        and(
          eq(dbConnectors.organizationId, orgId),
          eq(dbConnectors.accountId, accountId)
        )
      )
      .limit(1);

    if (!conn || !conn.accessToken) {
      throw new Error("QuickBooks is not connected for this account.");
    }

    const appBaseUrl = params?.appBaseUrl || "http://localhost:3000";
    const oauthClient = this.getOAuthClient(appBaseUrl);
    
    // Resolve realmId from settings or metadata
    const realmId = (conn.settings as any)?.realmId || (conn.settings as any)?.qboRealmId;

    oauthClient.setToken({
      access_token: conn.accessToken,
      refresh_token: conn.refreshToken || "",
      realmId: realmId,
    });

    // Auto-refresh token if expiring in next 5 mins
    if (conn.tokenExpiresAt && new Date() > new Date(conn.tokenExpiresAt.getTime() - 5 * 60_000)) {
      try {
        const authResponse = await oauthClient.refresh();
        const tokenData = authResponse.getJson();
        const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
        await db
          .update(dbConnectors)
          .set({
            accessToken: tokenData.access_token,
            refreshToken: tokenData.refresh_token,
            tokenExpiresAt: expiresAt,
          })
          .where(eq(dbConnectors.id, conn.id));
      } catch (refreshErr) {
        throw new Error("QuickBooks session expired. Please reconnect.");
      }
    }

    const base = oauthClient.environment === "sandbox"
      ? OAuthClient.environment.sandbox
      : OAuthClient.environment.production;

    const queryApi = async (query: string): Promise<any[]> => {
      const url = `${base}v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
      const response = await oauthClient.makeApiCall({ url, method: "GET" });
      const body = typeof (response as any).json === "function"
        ? await (response as any).json()
        : (response as any).data;
      return body?.QueryResponse ?? {};
    };

    const MAX = 100;

    // Fetch entity types in parallel
    const [
      invoiceResp,
      paymentResp,
      depositResp,
      customerResp,
    ] = await Promise.allSettled([
      queryApi(`select * from Invoice maxresults ${MAX}`),
      queryApi(`select * from Payment maxresults ${MAX}`),
      queryApi(`select * from Deposit maxresults ${MAX}`),
      queryApi(`select * from Customer maxresults ${MAX}`),
    ]);

    const extract = (res: PromiseSettledResult<any>, key: string): any[] => {
      if (res.status === "fulfilled") return res.value[key] || [];
      console.warn(`QBO Connector sync failed for ${key}:`, (res as any).reason?.message);
      return [];
    };

    const invoices = extract(invoiceResp, "Invoice");
    const payments = extract(paymentResp, "Payment");
    const deposits = extract(depositResp, "Deposit");
    const customers = extract(customerResp, "Customer");

    // Sync Customers to counterparty_profiles
    if (customers.length > 0) {
      const customerProfiles = customers.map((c) => ({
        organizationId: orgId,
        normalizedName: c.DisplayName.trim().toLowerCase(),
        metadata: {
          qboId: c.Id,
          email: c.PrimaryEmailAddr?.Address || null,
          phone: c.PrimaryPhone?.FreeFormNumber || null,
          displayName: c.DisplayName,
        },
      }));
      // Inser/upsert customer profiles
      await db.insert(counterpartyProfiles).values(customerProfiles).onConflictDoNothing();
    }

    const records: NormalizedConnectorRecord[] = [];

    // Map Invoices (books outflow/inflow? Usually an invoice is books inflow/sales - mapped to inflow or outflow based on amount)
    invoices.forEach((inv) => {
      const amt = Math.round(Number(inv.TotalAmt) * 100);
      records.push({
        sourceTransactionId: inv.Id,
        transactionDate: new Date(inv.TxnDate || Date.now()),
        amountMinor: BigInt(amt),
        currency: inv.CurrencyRef?.value || "USD",
        referenceNumber: inv.DocNumber || inv.Id,
        counterpartyName: inv.CustomerRef?.name,
        description: inv.CustomerRef?.name
          ? `Invoice #${inv.DocNumber} — ${inv.CustomerRef.name}`
          : `Invoice #${inv.DocNumber}`,
        transactionType: "INVOICE",
        metadata: { qboType: "Invoice", balance: inv.Balance },
      });
    });

    // Map Payments
    payments.forEach((pmt) => {
      const amt = Math.round(Number(pmt.TotalAmt) * 100);
      records.push({
        sourceTransactionId: pmt.Id,
        transactionDate: new Date(pmt.TxnDate || Date.now()),
        amountMinor: BigInt(amt),
        currency: pmt.CurrencyRef?.value || "USD",
        referenceNumber: pmt.DocNumber || pmt.Id,
        counterpartyName: pmt.CustomerRef?.name,
        description: pmt.CustomerRef?.name
          ? `Payment from ${pmt.CustomerRef.name}`
          : `Payment #${pmt.Id}`,
        transactionType: "PAYMENT",
        metadata: { qboType: "Payment" },
      });
    });

    // Map Deposits
    deposits.forEach((dep) => {
      const amt = Math.round(Number(dep.TotalAmt) * 100);
      records.push({
        sourceTransactionId: dep.Id,
        transactionDate: new Date(dep.TxnDate || Date.now()),
        amountMinor: BigInt(amt),
        currency: dep.CurrencyRef?.value || "USD",
        referenceNumber: dep.Id,
        description: `Bank Deposit — ${dep.DepositToAccountRef?.name || dep.Id}`,
        transactionType: "DEPOSIT",
        metadata: { qboType: "Deposit" },
      });
    });

    return records;
  }
}
