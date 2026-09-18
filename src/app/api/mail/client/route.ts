import { NextResponse } from "next/server";

import { identify } from "@/lib/api-auth";
import { serverSupabase } from "@/lib/supabase-server";

/**
 * The Google OAuth client for this installation.
 *
 * One per installation, not one per person: every officer who signs in does so
 * through this same client. It identifies the application to Google, and the
 * accounts people connect through it live in mail_accounts.
 *
 * ---------------------------------------------------------------------------
 * Write only, on purpose
 *
 * GET says whether a client is set and what its id is. It never returns the
 * secret, to anybody, including a super admin. A form that showed the secret
 * back would put it in a browser, in whatever that browser decides to remember
 * and in any log that captures a response body. There is no reading it once it
 * is in: it is replaced, not edited.
 *
 * Only an administrator may change it, because swapping the client points
 * every future sign in at a different Google project.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function admin(role: string): boolean {
  return role === "admin" || role === "super-admin";
}

/** The exact string that has to be pasted into the Google credential. */
function redirectFor(request: Request): string {
  const base = (
    process.env.APP_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    new URL(request.url).origin
  )
    .trim()
    .replace(/\/+$/, "");
  return `${base}/api/mail/callback`;
}

export async function GET(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const { data, error } = await db
    .from("oauth_client")
    .select("client_id,redirect_uri,updated_at")
    .maybeSingle();

  if (error && !/does not exist|schema cache/i.test(error.message)) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 502 });
  }

  const fromEnv = Boolean(
    (process.env.GOOGLE_CLIENT_ID ?? "").trim() &&
      (process.env.GOOGLE_CLIENT_SECRET ?? "").trim(),
  );

  return NextResponse.json({
    ok: true,
    /* The id is not a secret. Google shows it in the address bar of every
       consent screen, and seeing it is how somebody confirms they are looking
       at the right project. */
    clientId: (data?.client_id as string | null) ?? null,
    stored: Boolean(data),
    /* Said separately so a screen can explain that sign in works but is using
       the fallback, which is a different situation from nothing being set. */
    usingEnvironment: !data && fromEnv,
    updatedAt: (data?.updated_at as string | null) ?? null,
    redirectUri: (data?.redirect_uri as string | null) ?? redirectFor(request),
    canEdit: admin(who.caller.role),
    tableMissing: Boolean(error),
  });
}

export async function POST(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!admin(who.caller.role)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Only an administrator can change the Google client. It decides " +
          "which Google project everybody signs in to.",
      },
      { status: 403 },
    );
  }

  let body: { clientId?: string; clientSecret?: string; redirectUri?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Unreadable request." }, { status: 400 });
  }

  const clientId = (body.clientId ?? "").trim();
  const clientSecret = (body.clientSecret ?? "").trim();

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { ok: false, error: "Both the client id and the client secret are needed." },
      { status: 400 },
    );
  }

  /*
   * Checked because the two are easy to paste the wrong way round, and doing
   * so produces a Google error weeks of confusion later rather than now.
   * Google's ids end in .apps.googleusercontent.com and their secrets do not.
   */
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "That does not look like a Google client id. They end in " +
          ".apps.googleusercontent.com. Check the two fields are not swapped.",
      },
      { status: 400 },
    );
  }
  if (/\.apps\.googleusercontent\.com$/.test(clientSecret)) {
    return NextResponse.json(
      { ok: false, error: "The secret field has a client id in it. The two are swapped." },
      { status: 400 },
    );
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const redirectUri = (body.redirectUri ?? "").trim() || redirectFor(request);

  const { error } = await db.from("oauth_client").upsert(
    {
      id: true,
      provider: "google",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      updated_by: who.caller.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  if (error) {
    const missing = /does not exist|schema cache/i.test(error.message);
    return NextResponse.json(
      {
        ok: false,
        error: missing
          ? "This database does not have 0016_oauth_client.sql applied yet."
          : error.message,
      },
      { status: 502 },
    );
  }

  /*
   * Recorded, because swapping the client points every future sign in at a
   * different Google project. A legitimate thing for MES to do, and an
   * unhelpful one to discover by accident.
   */
  await db.from("audit_log").insert({
    actor: who.caller.userId,
    actor_name: who.caller.email ?? "unknown",
    action: "Changed the Google sign in client",
    subject: clientId,
    meta: { redirectUri },
  });

  return NextResponse.json({ ok: true, clientId, redirectUri });
}

export async function DELETE(request: Request) {
  const who = await identify(request);
  if (!who.ok) {
    return NextResponse.json({ ok: false, error: who.error }, { status: who.status });
  }
  if (!admin(who.caller.role)) {
    return NextResponse.json(
      { ok: false, error: "Only an administrator can remove the Google client." },
      { status: 403 },
    );
  }

  let db;
  try {
    db = serverSupabase();
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }

  const { error } = await db.from("oauth_client").delete().eq("id", true);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 502 });

  await db.from("audit_log").insert({
    actor: who.caller.userId,
    actor_name: who.caller.email ?? "unknown",
    action: "Removed the Google sign in client",
    subject: "oauth_client",
    meta: {},
  });

  /*
   * Said out loud. Removing the stored client does not necessarily stop sign
   * in: the environment may still hold one, and somebody who removed it
   * expecting sign in to stop would be wrong about that.
   */
  const fromEnv = Boolean(
    (process.env.GOOGLE_CLIENT_ID ?? "").trim() &&
      (process.env.GOOGLE_CLIENT_SECRET ?? "").trim(),
  );

  return NextResponse.json({
    ok: true,
    stillUsable: fromEnv,
    note: fromEnv
      ? "Removed. Sign in still works, using the client set in the environment."
      : "Removed. Nobody can connect a mailbox until a client is set again.",
  });
}
