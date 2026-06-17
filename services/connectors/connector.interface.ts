export interface NormalizedConnectorRecord {
  sourceTransactionId: string;
  transactionDate: Date;
  amountMinor: bigint; // positive = inflow, negative = outflow
  currency: string;
  referenceNumber?: string;
  counterpartyName?: string;
  description?: string;
  transactionType?: string;
  metadata?: Record<string, any>;
}

export interface Connector {
  connect(userId: string, orgId: string, accountId: string, params?: any): Promise<any>;
  sync(userId: string, orgId: string, accountId: string, params?: any): Promise<NormalizedConnectorRecord[]>;
  disconnect(userId: string, orgId: string, accountId: string): Promise<any>;
}
