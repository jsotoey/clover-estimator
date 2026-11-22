import { describe, expect, it } from "vitest";
import { redactAria } from "../src/scout";

describe("scout never records secrets", () => {
  it("hides every box value on a login page", () => {
    const aria = '- heading "Log in" [level=1]\n - textbox "Email": someone@example.com\n - textbox "Password": Secret123!\n - button "Log in"';
    const out = redactAria(aria);
    expect(out).not.toContain("Secret123!");
    expect(out).not.toContain("someone@example.com");
    expect(out).toContain('textbox "Password": [hidden]');
  });
  it("hides secret-looking boxes elsewhere, keeps ordinary ones", () => {
    const out = redactAria(' - textbox "Verification code": 123456\n - textbox "Note": Paint the hallway');
    expect(out).not.toContain("123456");
    expect(out).toContain("Paint the hallway");
  });
});
