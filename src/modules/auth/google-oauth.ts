import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { safeInternalPath } from "@/lib/safe-navigation";
import { isWorldCountryCode } from "@/lib/world-countries";

export const GOOGLE_OAUTH_STATE_COOKIE = "duar_google_oauth_state";
const STATE_ISSUER = "duar-google-oauth";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

type GoogleState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  nextPath: string;
  mode: "signin" | "signup";
  residenceCountryCode: string;
  accountType: "PERSONAL" | "BUSINESS";
};

function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value === "replace-with-a-long-random-secret") throw new Error("AUTH_SECRET is not configured.");
  return new TextEncoder().encode(value);
}

function randomValue() {
  return randomBytes(32).toString("base64url");
}

function codeChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function googleOauthConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function googleRedirectUri(requestUrl: URL) {
  const applicationBase = new URL(process.env.APP_BASE_URL?.trim() || requestUrl.origin);
  const expected = new URL("/api/v1/auth/oauth/google/callback", applicationBase);
  const configured = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (!configured) return expected.toString();
  const redirect = new URL(configured);
  if (redirect.origin !== applicationBase.origin || redirect.pathname !== expected.pathname || redirect.search || redirect.hash) throw new Error("Google OAuth redirect URI must be this application's callback URL.");
  return redirect.toString();
}

export async function createGoogleState(input: Omit<GoogleState, "state" | "nonce" | "codeVerifier">) {
  const payload: GoogleState = { ...input, state: randomValue(), nonce: randomValue(), codeVerifier: randomValue() };
  const token = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuer(STATE_ISSUER).setAudience("google-oauth-state").setIssuedAt().setExpirationTime("10m").sign(authSecret());
  return { token, payload, codeChallenge: codeChallenge(payload.codeVerifier) };
}

export async function readGoogleState(token: string | undefined, returnedState: string | null) {
  if (!token || !returnedState) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret(), { issuer: STATE_ISSUER, audience: "google-oauth-state" });
    const state = payload as unknown as GoogleState;
    if (state.state !== returnedState || !state.nonce || !state.codeVerifier || !["signin", "signup"].includes(state.mode) || !isWorldCountryCode(state.residenceCountryCode) || !["PERSONAL", "BUSINESS"].includes(state.accountType)) return null;
    return state;
  } catch {
    return null;
  }
}

export function googleStartUrl(input: { redirectUri: string; state: string; nonce: string; codeChallenge: string }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!.trim(), redirect_uri: input.redirectUri, response_type: "code", scope: "openid email profile", state: input.state, nonce: input.nonce, code_challenge: input.codeChallenge, code_challenge_method: "S256", prompt: "select_account" }).toString();
  return url.toString();
}

export async function verifyGoogleCallback(input: { code: string; redirectUri: string; codeVerifier: string; nonce: string }) {
  const body = new URLSearchParams({ code: input.code, client_id: process.env.GOOGLE_CLIENT_ID!.trim(), client_secret: process.env.GOOGLE_CLIENT_SECRET!.trim(), redirect_uri: input.redirectUri, grant_type: "authorization_code", code_verifier: input.codeVerifier });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store" });
  const data = await response.json().catch(() => null) as { id_token?: unknown } | null;
  if (!response.ok || !data || typeof data.id_token !== "string") throw new Error("Google could not verify this sign-in.");
  const { payload } = await jwtVerify(data.id_token, googleKeys, { audience: process.env.GOOGLE_CLIENT_ID!.trim(), issuer: GOOGLE_ISSUERS });
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  if (!subject || !email || payload.email_verified !== true || payload.nonce !== input.nonce) throw new Error("Google did not return a verified account.");
  return { subject, email, name: name.slice(0, 120) || email.split("@")[0].slice(0, 120) || "DeshDak customer" };
}

export function oauthNextPath(value: unknown, fallback: string) {
  return safeInternalPath(value, fallback);
}
