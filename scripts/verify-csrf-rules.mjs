import assert from "node:assert/strict";
import { isTrustedBrowserMutation } from "../src/lib/csrf.ts";

const base = { requestOrigin: "https://app.crossly.example", fetchSite: "same-origin" };

assert.equal(isTrustedBrowserMutation({ ...base, method: "GET", hasBrowserSession: true, origin: null }), true, "Safe reads must not require Origin.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "POST", hasBrowserSession: false, origin: null }), true, "Non-cookie API clients must remain compatible.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "POST", hasBrowserSession: true, origin: base.requestOrigin }), true, "Same-origin browser mutation was rejected.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "DELETE", hasBrowserSession: true, origin: null }), false, "Missing Origin was accepted.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "PATCH", hasBrowserSession: true, origin: "null" }), false, "Opaque Origin was accepted.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "POST", hasBrowserSession: true, origin: "https://attacker.example" }), false, "Cross-origin mutation was accepted.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "POST", hasBrowserSession: true, origin: base.requestOrigin, fetchSite: "cross-site" }), false, "Cross-site Fetch Metadata was accepted.");
assert.equal(isTrustedBrowserMutation({ ...base, method: "POST", hasBrowserSession: true, origin: "not a URL" }), false, "Malformed Origin was accepted.");

console.log("CSRF rule verification passed: safe reads and non-cookie clients remain compatible; cookie mutations require same-origin evidence.");
