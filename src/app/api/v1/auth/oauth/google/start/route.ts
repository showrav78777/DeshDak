import { NextRequest, NextResponse } from "next/server";
import { googleOauthConfigured, googleRedirectUri, googleStartUrl, GOOGLE_OAUTH_STATE_COOKIE, createGoogleState, oauthNextPath } from "@/modules/auth/google-oauth";
import { isWorldCountryCode } from "@/lib/world-countries";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "signup" ? "signup" : "signin";
  if (!googleOauthConfigured()) return NextResponse.redirect(new URL(`/${mode === "signup" ? "register" : "login"}?google=unavailable`, request.url), 303);
  const country = request.nextUrl.searchParams.get("country")?.toUpperCase() ?? "BD";
  const accountType = request.nextUrl.searchParams.get("accountType") === "BUSINESS" ? "BUSINESS" : "PERSONAL";
  const state = await createGoogleState({ mode, nextPath: oauthNextPath(request.nextUrl.searchParams.get("next"), mode === "signup" ? "/profile?onboarding=1" : "/dashboard"), residenceCountryCode: isWorldCountryCode(country) ? country : "BD", accountType });
  let redirectUri: string;
  try { redirectUri = googleRedirectUri(request.nextUrl); } catch { return NextResponse.redirect(new URL(`/${mode === "signup" ? "register" : "login"}?google=misconfigured`, request.url), 303); }
  const response = NextResponse.redirect(googleStartUrl({ redirectUri, state: state.payload.state, nonce: state.payload.nonce, codeChallenge: state.codeChallenge }), 303);
  response.cookies.set({ name: GOOGLE_OAUTH_STATE_COOKIE, value: state.token, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
