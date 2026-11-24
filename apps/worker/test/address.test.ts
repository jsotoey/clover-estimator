import { describe, expect, it } from "vitest";
import { parseUsAddress } from "../src/clover/fillEstimate";

describe("parseUsAddress", () => {
  it("splits a typical address", () => {
    expect(parseUsAddress("14 Park St, Montclair, NJ 07042")).toEqual({ street: "14 Park St", city: "Montclair", stateCode: "NJ", zip: "07042" });
  });
  it("handles full state names and no zip", () => {
    expect(parseUsAddress("22 Elm Ave, Bloomfield, New Jersey")).toEqual({ street: "22 Elm Ave", city: "Bloomfield", stateCode: "NJ", zip: undefined });
  });
  it("handles 'City NJ' without a comma before the state", () => {
    expect(parseUsAddress("99 Elm St, Montclair NJ 07042")).toEqual({ street: "99 Elm St", city: "Montclair", stateCode: "NJ", zip: "07042" });
  });
  it("gives up on non-addresses", () => {
    expect(parseUsAddress("his house")).toBeNull();
  });
});
