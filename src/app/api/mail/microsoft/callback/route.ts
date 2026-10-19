import { NextResponse } from "next/server";

import { serverSupabase } from "@/lib/supabase-server";
import { exchange, microsoftConfig } from "@/lib/mail/microsoft-oauth";
import { plainMicrosoftDenial } from "@/lib/mail/microsoft-config";
import { readState } from "@/lib/mail/state";
import { save } from "@/lib/mail/accounts";

/**
 * Where Microsoft sends somebody back to after "Connect Outlook".
 *
 * The twin of /api/mail/callback, which is Google's. It redirects to Settings
 * with the outcome in the query string, and takes whose account this is from
 * the signed state, never from anything else in the URL.
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

  // Cancelled, or an organisation that needs an administrator to approve it.
  const denied = url.searchParams.get("error");
  if (denied) {
    const detail = plainMicrosoftDenial(denied, url.searchParams.get("error_description"));
    return back(base, {
      mail: denied === "access_denied" && !/administrator/.test(detail) ? "cancelled" : "failed",
      detail,
    });
  }

  const code = url.searchParams.get("code");
  const state = readState(url.searchParams.get("state") ?? "");

  if ("error" in state) return back(base, { mail: "failed", detail: state.error });
  if (!code) return back(base, { mail: "failed", detail: "Microsoft sent no code back." });

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return back(base, { mail: "failed", detail: (e as Error).message });
  }

  const config = microsoftConfig();
  if ("error" in config) return back(base, { mail: "failed", detail: config.error });

  const connected = await exchange(config, code);
  if ("error" in connected) return back(base, { mail: "failed", detail: connected.error });

  const stored = await save(db, state.userId, { ...connected, provider: "microsoft" });
  if (!stored.ok) return back(base, { mail: "failed", detail: stored.error });

  return back(base, {
    mail: "connected",
    as: connected.email,
    scheduled: stored.isDefault ? "1" : "0",
  });
}
