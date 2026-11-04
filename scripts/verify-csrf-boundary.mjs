const baseUrl = process.env.TEST_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:3000";
const origin = new URL(baseUrl).origin;
const endpoint = `${origin}/api/v1/auth/login`;
const invalidLogin = JSON.stringify({});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(headers = {}) {
  const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: invalidLogin });
  return { response, body: await response.json() };
}

const anonymous = await request();
assert(anonymous.response.status === 422, "Anonymous API client was incorrectly blocked by the cookie CSRF boundary.");

const missingOrigin = await request({ Cookie: "crossly_session=invalid-test-session" });
assert(missingOrigin.response.status === 403 && missingOrigin.body.error?.code === "UNTRUSTED_ORIGIN", "Cookie mutation without Origin reached application code.");
assert(Boolean(missingOrigin.response.headers.get("x-request-id")), "Rejected mutation did not retain its correlation ID.");

const crossOrigin = await request({ Cookie: "crossly_session=invalid-test-session", Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" });
assert(crossOrigin.response.status === 403 && crossOrigin.body.error?.code === "UNTRUSTED_ORIGIN", "Cross-site cookie mutation reached application code.");

const sameOrigin = await request({ Cookie: "crossly_session=invalid-test-session", Origin: origin, "Sec-Fetch-Site": "same-origin" });
assert(sameOrigin.response.status === 422, "Same-origin cookie mutation did not reach the route handler.");

console.log("CSRF boundary verification passed: anonymous/mobile-safe access remains open and signed-in browser mutations fail closed outside the application origin.");
