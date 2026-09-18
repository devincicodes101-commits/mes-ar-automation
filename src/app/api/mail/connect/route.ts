import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { consentUrl, googleConfig } from "@/lib/mail/google-oauth";
import { signState } from "@/lib/mail/state";

/**
 * Where "Connect Google" goes.
 *
 * Returns the URL rather than redirecting, because the caller is a screen
 * holding a Supabase token in a header. A redirect would drop that header at
 * Google's door and come back as a stranger.
 *
 * The state parameter carries who asked, signed, so the callback knows whose
 * account it is without trusting anything in the query string. Google hands
 * that value back untouched, and anybody can put anything in a URL.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }

  const config = googleConfig();
  if ("error" in config) {
    return NextResponse.json({ ok: false, error: config.error }, { status: 500 });
  }

  const state = signState({ userId: who.caller.userId, at: Date.now() });
  return NextResponse.json({ ok: true, url: consentUrl(config, state) });
}
