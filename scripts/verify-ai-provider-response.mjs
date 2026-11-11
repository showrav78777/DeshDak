import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

const source = await readFile(new URL("../src/modules/ai/generative-shopping-assistant.ts", import.meta.url), "utf8");
const { generateShoppingAssistantReply: reply } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);
const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalModel = process.env.OPENAI_CHAT_MODEL;
const input = { message: "Find earbuds. Contact buyer@example.test", marketCountry: "BD", fallbackAnswer: "Browse the approved catalog.", products: [], history: [{ role: "user", text: "Call +8801934591062" }] };
const message = (text) => ({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text }] });
const completed = (...output) => ({ status: "completed", output });
let calls = 0;
try {
  process.env.OPENAI_API_KEY = "synthetic-test-key";
  process.env.OPENAI_CHAT_MODEL = "configured-test-model";
  const respond = (payload, status = 200) => {
    globalThis.fetch = async (url, options) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer synthetic-test-key");
      assert(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.model, "configured-test-model");
      assert.equal(body.store, false);
      assert.equal(body.max_output_tokens, 420);
      assert(!options.body.includes("buyer@example.test"));
      assert(!options.body.includes("8801934591062"));
      return Response.json(payload, { status });
    };
  };
  respond(completed({ type: "reasoning", summary: [{ text: "PRIVATE_REASONING" }] }, message("Approved earbuds are available.")));
  assert.equal(await reply(input), "Approved earbuds are available.");
  respond(completed(message("First."), { type: "function_call", arguments: "PRIVATE_TOOL_ARGUMENTS" }, message("Second.")));
  assert.equal(await reply(input), "First.\nSecond.");
  for (const payload of [null, {}, { output_text: "SDK convenience field only" }, completed(), completed(message("  ")), completed(message("x".repeat(3001))), { ...completed(message("Partial")), status: "incomplete" }, { ...completed(message("Failed")), error: { message: "PRIVATE_DIAGNOSTIC" } }, { ...completed(message("Partial")), incomplete_details: { reason: "max_output_tokens" } }, completed({ ...message("Partial"), status: "in_progress" }), completed({ ...message("Wrong role"), role: "user" }), completed({ ...message("Mixed refusal"), content: [{ type: "output_text", text: "Partial" }, { type: "refusal", refusal: "No" }] }), completed({ ...message("Bad text"), content: [{ type: "output_text", text: 42 }] })]) {
    respond(payload);
    assert.equal(await reply(input), null);
  }
  respond(completed(message("Do not accept failed HTTP responses")), 429);
  assert.equal(await reply(input), null);
  globalThis.fetch = async () => new Response("invalid JSON");
  assert.equal(await reply(input), null);
  globalThis.fetch = async () => { throw new Error("PRIVATE_PROVIDER_DIAGNOSTIC"); };
  assert.equal(await reply(input), null);
  delete process.env.OPENAI_API_KEY;
  const previousCalls = calls;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  assert.equal(await reply(input), null);
  assert.equal(calls, previousCalls);
  console.log("AI provider response checks passed: real REST output shape, multiple messages, hidden reasoning/tools, incomplete/refusal/error fallback, limits, redaction and missing credentials. All provider responses were simulated; no paid API calls.");
} finally {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.OPENAI_CHAT_MODEL; else process.env.OPENAI_CHAT_MODEL = originalModel;
}
