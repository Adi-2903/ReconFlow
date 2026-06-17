import { QboConnector } from "./qbo.connector";
import { StripeConnector } from "./stripe.connector";

export const connectors = {
  quickbooks: new QboConnector(),
  stripe: new StripeConnector(),
};

export type ConnectorType = keyof typeof connectors;
export * from "./connector.interface";
