import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase-server";
import { exchange, googleConfig } from "@/lib/mail/google-oauth";
import { readState } from "@/lib/mail/state";
import { save } from "@/lib/mail/accounts";

/**
 * Where Google sends somebody back to.
 *
 * This one does redirect, to a screen, because the person arrives here in
 * their browser rather than through a fetch. It carries the outcome in the
 * query string so Settings can say what happened instead of quietly showing a
 * connected or unconnected state with no explanation.
 *
 * Whose account this is comes from the signed state, never from anything else
 * in the URL. Google returns state untouched, and a token filed against the
 * wrong person would be a quiet way to send letters as somebody else.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function back(base: string, params: Record<string, string>): NextResponse {
  const q = new URLSearchParams(params);
  return NextResponse.redirect(`${base}/settings?${q.toString()}`);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = (process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? url.origin)
    .replace(/\/+$/, "");

  // The person pressed Cancel on Google's consent screen. Not a fault.
  const denied = url.searchParams.get("error");
  if (denied) {
    return back(base, {
      mail: "cancelled",
      detail: denied === "access_denied" ? "The connection was not approved." : denied,
    });
  }

  const code = url.searchParams.get("code");
  const state = readState(url.searchParams.get("state") ?? "");

  if ("error" in state) return back(base, { mail: "failed", detail: state.error });
  if (!code) return back(base, { mail: "failed", detail: "Google sent no code back." });

  const config = googleConfig();
  if ("error" in config) return back(base, { mail: "failed", detail: config.error });

  const connected = await exchange(config, code);
  if ("error" in connected) return back(base, { mail: "failed", detail: connected.error });

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return back(base, { mail: "failed", detail: (e as Error).message });
  }

  const stored = await save(db, state.userId, connected);
  if (!stored.ok) return back(base, { mail: "failed", detail: stored.error });

  return back(base, {
    mail: "connected",
    as: connected.email,
    // Said out loud, because being the account the schedule sends from is a
    // bigger thing than connecting, and nobody chose it deliberately here.
    scheduled: stored.isDefault ? "1" : "0",
  });
}
