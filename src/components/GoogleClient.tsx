"use client";

/**
 * Setting up the Google sign in, from inside the app.
 *
 * These credentials used to live in environment variables, which meant only
 * somebody with access to the hosting account could change them and every
 * change needed a redeploy. For a system MES will own, that is the wrong
 * shape: they should be able to point it at their own Google project and
 * rotate the secret without waiting for anybody.
 *
 * The secret goes in and never comes back. This screen is told whether one is
 * set, never what it is. There is no editing it, only replacing it.
 */

import { useCallback, useEffect, useState } from "react";

import { useSession, useToast } from "@/lib/session";
import { Card, CardHeader, Spinner, StatusBadge } from "@/components/ui";

interface ClientState {
  clientId: string | null;
  stored: boolean;
  usingEnvironment: boolean;
  updatedAt: string | null;
  redirectUri: string;
  canEdit: boolean;
  tableMissing: boolean;
}

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export function GoogleClient() {
  const { role } = useSession();
  const { notify } = useToast();
  const [state, setState] = useState<ClientState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);

  const admin = role === "admin" || role === "super-admin";

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/mail/client", { headers: await authHeader() });
      const body = (await r.json()) as ClientState & { ok?: boolean; error?: string };
      if (body.ok) setState(body);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/mail/client", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({
          clientId: id.trim(),
          clientSecret: secret.trim(),
          redirectUri: state?.redirectUri,
        }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      if (body.ok) {
        notify("Google sign in is set up", "Anybody can now connect their mailbox.");
        setId("");
        setSecret("");
        setOpen(false);
        await load();
      } else {
        notify("Not saved", body.error ?? "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading || !state) return null;
  // Not an administrator's business, and showing a form they cannot submit is
  // just a way of telling somebody off for reading.
  if (!admin) return null;

  const ready = state.stored || state.usingEnvironment;

  return (
    <Card>
      <CardHeader
        title="Google sign in"
        hint="One setup for the whole system. After this, everybody just presses the button."
        right={
          <StatusBadge
            kind={ready ? "good" : "warning"}
            label={ready ? "Set up" : "Not set up"}
          />
        }
      />

      <div className="space-y-3 px-5 py-4">
        {state.tableMissing ? (
          <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            This database does not have 0016_oauth_client.sql applied yet, so
            nothing can be saved here.
          </p>
        ) : null}

        {ready ? (
          <p className="text-sm text-ink-secondary">
            {state.stored ? (
              <>
                Signing in through{" "}
                <span className="font-mono text-xs text-ink">{state.clientId}</span>
              </>
            ) : (
              "Signing in using the client set in the environment. Saving one here " +
              "replaces it, and means MES can change it without a deploy."
            )}
          </p>
        ) : (
          <p className="text-sm text-ink">
            Nobody can connect a mailbox until this is filled in. It is done once,
            by one person, and takes about five minutes.
          </p>
        )}

        {/*
          The single most common way this fails is a redirect address that
          differs from Google's by one character, and Google's own error does
          not say what to compare against. So the exact string is shown here to
          be copied rather than typed.
        */}
        <div className="rounded border border-line-hair bg-surface-alt px-3 py-2.5">
          <p className="text-xs font-medium text-ink">
            Paste this into Google as an Authorised redirect URI
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs text-ink-secondary">
              {state.redirectUri}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(state.redirectUri);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
              className="shrink-0 rounded border border-line-hair bg-surface px-2.5 py-1 text-xs text-ink hover:border-line-strong"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-ink-muted">
            It has to match character for character, including https and the
            absence of a trailing slash.
          </p>
        </div>

        {open ? (
          <div className="space-y-2.5">
            <label className="block">
              <span className="text-xs font-medium text-ink">Client ID</span>
              <input
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="1234567890-abcdef.apps.googleusercontent.com"
                className="mt-1 w-full rounded border border-line-hair px-3 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-ink">Client secret</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="GOCSPX-..."
                className="mt-1 w-full rounded border border-line-hair px-3 py-2 text-sm"
              />
              {/* Said before they type it, not after they wonder. */}
              <span className="mt-1 block text-xs text-ink-muted">
                Saved and never shown again. To change it later, paste a new one.
              </span>
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !id.trim() || !secret.trim()}
                onClick={() => void save()}
                className="rounded bg-ink px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {busy ? <Spinner /> : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded border border-line-hair px-3 py-2 text-sm text-ink hover:border-line-strong"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-line-hair px-3 py-2 text-sm text-ink hover:border-line-strong"
          >
            {ready ? "Replace the client" : "Enter the client id and secret"}
          </button>
        )}

        <details className="text-xs text-ink-secondary">
          <summary className="cursor-pointer text-ink">
            Where do the id and secret come from?
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Go to console.cloud.google.com and create a project</li>
            <li>APIs &amp; Services, then OAuth consent screen. Choose External</li>
            <li>Add the people who will connect a mailbox under Test users</li>
            <li>Credentials, Create Credentials, OAuth client ID, Web application</li>
            <li>Add the redirect address above, exactly as shown</li>
            <li>Copy the client id and secret back here</li>
          </ol>
          <p className="mt-2">
            The consent screen will ask to read, send and delete mail. That is
            Google&apos;s wording for what sending over SMTP requires, and a
            narrower permission will not work.
          </p>
        </details>
      </div>
    </Card>
  );
}
