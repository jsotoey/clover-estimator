import { describe, expect, it } from "vitest";
import { cloverHealth } from "../lib/cloverHealth";

const ok = { bot: { online: true, known: true }, store: { paused: false, signedIn: true, storeOk: true }, waitingEstimates: 0 };
describe("Clover health", () => {
  it("all good is green with no banner", () => expect(cloverHealth(ok)).toEqual({ state: "on", problem: null }));
  it("bot computer off", () => expect(cloverHealth({ ...ok, bot: { online: false, known: true } }).problem).toMatch(/computer is off/));
  it("signed out", () => expect(cloverHealth({ ...ok, store: { ...ok.store, signedIn: false } }).problem).toMatch(/signed out/));
  it("wrong store", () => expect(cloverHealth({ ...ok, store: { ...ok.store, storeOk: false } }).problem).toMatch(/different store/));
  it("waiting estimates", () => expect(cloverHealth({ ...ok, waitingEstimates: 2 }).problem).toMatch(/2 estimates are waiting/));
  it("paused store stays quiet", () => expect(cloverHealth({ ...ok, store: { ...ok.store, paused: true, signedIn: false } }).problem).toBeNull());
  it("old worker with no check-in yet doesn't cry wolf", () => expect(cloverHealth({ ...ok, bot: { online: false, known: false } }).problem).toBeNull());
});
