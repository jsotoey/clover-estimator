/**
 * Accessibility outlines include what's typed in text boxes. Hide the value of any box that could hold
 * a secret (password, email, code, PIN), and every box value on a login page.
 */
export function redactAria(aria: string): string {
  const onLogin = /heading "Log in"|button "Log in"|textbox "Password"/i.test(aria);
  return aria
    .split("\n")
    .map((line) => {
      const m = line.match(/^(\s*-\s*textbox\s+"([^"]*)"[^:]*):\s*(.+)$/);
      if (!m) return line;
      return onLogin || /password|passcode|pin|code|email|otp|token/i.test(m[2]) ? `${m[1]}: [hidden]` : line;
    })
    .join("\n");
}
