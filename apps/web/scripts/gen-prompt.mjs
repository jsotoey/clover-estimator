// Copies the AI brief from /prompts into the web bundle (Vercel only ships apps/web).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../../prompts/estimate-assistant.md");
const md = fs.readFileSync(src, "utf8");
const start = md.indexOf("\n---\n");
const end = md.indexOf("## submit_estimate (tool schema)");
if (start < 0 || end < 0) throw new Error("Could not find the prompt section markers in estimate-assistant.md");
const prompt = md.slice(start + 5, end).trim();
const out = path.resolve(here, "../lib/systemPrompt.generated.ts");
fs.writeFileSync(out, `// GENERATED from prompts/estimate-assistant.md by scripts/gen-prompt.mjs. Do not edit.\nexport const SYSTEM_PROMPT = ${JSON.stringify(prompt)};\n`);
console.log(`wrote ${path.relative(process.cwd(), out)} (${prompt.length} chars)`);
