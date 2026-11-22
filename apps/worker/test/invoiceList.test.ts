import { describe, expect, it } from "vitest";
import { isPaidStatus, matchInvoiceRows, parseInvoiceTable } from "../src/clover/fillEstimate";

const headers = ["Reference #", "Invoice #", "Customer", "", "Total", "Sent date", "Due date", "Status", ""];
const rows = [
  ["", "4CEYAYGDB5FN6", "Jon Soto", "", "$955.18", "Nov 20, 2026", "Nov 20, 2026", "Paid", ""],
  ["", "9XK2", "Jon Soto", "", "$1,432.77", "Nov 21, 2026", "Upon receipt", "Unpaid", ""],
  ["", "7QQ", "Maria Lopez", "", "$955.18", "Nov 19, 2026", "", "Overdue", ""],
];

describe("Clover invoice list", () => {
  const parsed = parseInvoiceTable(headers, rows);
  it("reads columns by name", () => {
    expect(parsed[0]).toMatchObject({ number: "4CEYAYGDB5FN6", customer: "Jon Soto", totalCents: 95518, status: "Paid" });
    expect(parsed[1].totalCents).toBe(143277);
  });
  it("matches by first name and amount, ignoring a TEST prefix", () => {
    expect(matchInvoiceRows(parsed, "TEST Jon Soto", 95518).map((r) => r.number)).toEqual(["4CEYAYGDB5FN6"]);
    expect(matchInvoiceRows(parsed, "Maria Lopez", 95518).map((r) => r.number)).toEqual(["7QQ"]);
    expect(matchInvoiceRows(parsed, "Jon Soto", 12345)).toEqual([]);
  });
  it("only Paid counts as paid", () => {
    expect(isPaidStatus("Paid")).toBe(true);
    expect(isPaidStatus("Unpaid")).toBe(false);
    expect(isPaidStatus("Partially paid")).toBe(false);
    expect(isPaidStatus("Overdue")).toBe(false);
  });
});
