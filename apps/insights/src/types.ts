/** One paid order, normalized from Clover (or the sample generator). Money is always in cents. */
export interface Order {
  id: string;
  createdAt: Date;
  totalCents: number;   // what the customer paid for the goods (before tip)
  tipCents: number;
  refundCents: number;
  lines: { name: string; qty: number; cents: number }[];
}

export interface Merchant {
  id: string;            // Clover merchant id (or "sample-…")
  name: string;          // "River Lime Roti Shop"
  contactName: string;   // who the email greets
  email: string;
  timezone: string;      // IANA, e.g. America/New_York
  tokenEnv?: string;     // env var holding this merchant's read-only Clover API token
  sample?: boolean;      // use generated sample data instead of Clover
}
