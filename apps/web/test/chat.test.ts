import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/systemPrompt.generated", () => ({ SYSTEM_PROMPT: "Deposit {{DEPOSIT}}% good {{VALID_DAYS}} days tax {{TAX}}" }));
import { plain, withOpenToolResults, buildSystemPrompt } from "../lib/chat";
import { parseAskOwner } from "../lib/estimateTool";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

describe("chat helpers", () => {
  it("strips markdown", () => {
    expect(plain("- **Customer:** Jon\n## Hi")).toBe("Customer: Jon\nHi");
  });
  it("answers an open ask_owner with the owner's message", () => {
    const convo: MessageParam[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "ask_owner", input: { question: "When?", options: ["Tomorrow", "Monday"] } }] },
    ];
    const out = withOpenToolResults(convo, [{ type: "text", text: "Monday" }]);
    expect(out).toEqual([{ type: "tool_result", tool_use_id: "t1", content: "Owner's answer: Monday" }]);
  });
  it("passes the message through when nothing is open", () => {
    const out = withOpenToolResults([{ role: "assistant", content: "ok" }], [{ type: "text", text: "x" }]);
    expect(out).toEqual([{ type: "text", text: "x" }]);
  });
  it("fills the standard terms into the prompt", () => {
    process.env.DEFAULT_DEPOSIT_PERCENT = "40";
    expect(buildSystemPrompt()).toMatch(/Deposit 40% good 29 days tax yes/);
  });
  it("parses ask_owner input", () => {
    expect(parseAskOwner({ question: "When?", options: ["a", "b", "c", "d", "e"], date_picker: true })).toEqual({ question: "When?", options: ["a", "b", "c", "d"], datePicker: true });
  });
});
