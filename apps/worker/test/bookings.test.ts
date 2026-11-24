import { describe, expect, it } from "vitest";
import { stateForZip } from "../src/bookings";

describe("state from ZIP", () => {
  it("covers the service area", () => {
    expect(stateForZip("07083")).toBe("NJ");
    expect(stateForZip("08854")).toBe("NJ");
    expect(stateForZip("10001")).toBe("NY");
    expect(stateForZip("06902")).toBe("CT");
  });
});
