"use client";

import { useMemo } from "react";
import type { SentEmail } from "@/lib/store";
import { useToast } from "@/lib/session";
import { ScrollPanel, StatusBadge, Tag } from "@/components/ui";

/**
 * One sent letter, shown in full.
 *
 * Lives here rather than inside a screen because two places need it: the
 * Outbox, and the Sent list on the reminder screen where somebody has just
 * pressed send and wants to see what actually went. Two copies of this would
 * drift, and the thing they would drift on is the warning that says a merge
 * field never got filled, which is the only reason the view exists.
 *
 * Three states, and only one is a fault:
 *
 *   body undefined   sent before letters were kept. Nothing is wrong.
 *   body ""          a letter really did go out blank.
 *   body has {{x}}   a merge field never resolved.
 */
export function LetterView({
  email,
  compact = false,
}: {
  email: SentEmail;
  /** Inside a modal the header is already there, so it is left off. */
  compact?: boolean;
}) {
  const { notify } = useToast();

  const leftovers = useMemo(
    () => Array.from(new Set((email.body ?? "").match(/\{\{\w+\}\}/g) ?? [])),
    [email.body],
  );
  const notCaptured = email.body === undefined;
  const sentEmpty = email.body !== undefined && email.body.trim() === "";

  return (
    <div className="min-w-0">
      {!compact ? (
        <div className="border-b border-line-hair px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{email.templateName}</Tag>
            <span className="text-[11px] text-ink-muted">
              {new Date(email.at).toLocaleString("en-SG")}
            </span>
            <CopyButton email={email} notify={notify} />
          </div>
          <Header email={email} />
        </div>
      ) : (
        <div className="border-b border-line-hair px-5 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Tag>{email.templateName}</Tag>
            <span className="text-[11px] text-ink-muted">
              {new Date(email.at).toLocaleString("en-SG")}
            </span>
            <CopyButton email={email} notify={notify} />
          </div>
          <Header email={email} />
        </div>
      )}

      {leftovers.length > 0 || sentEmpty || notCaptured ? (
        <div className="border-b border-line-hair px-5 py-2.5">
          <StatusBadge
            kind={notCaptured ? "neutral" : "critical"}
            label={
              notCaptured
                ? "Sent before letters were kept"
                : sentEmpty
                  ? "This letter was sent with an empty body"
                  : `Unfilled: ${leftovers.join(", ")}`
            }
          />
          {notCaptured ? (
            <p className="mt-1.5 text-[11px] text-ink-muted">
              Nothing is wrong with this send. Earlier versions recorded only
              the subject and recipients, so there is no letter to show. Send
              another and the full text will appear here.
            </p>
          ) : null}
        </div>
      ) : null}

      <ScrollPanel max={compact ? 440 : 400}>
        <pre className="tabular whitespace-pre-wrap px-5 py-4 text-[12px] leading-relaxed text-ink-secondary">
          {notCaptured
            ? "(this send predates letter capture)"
            : sentEmpty
              ? "(the letter really was empty)"
              : email.body}
        </pre>
      </ScrollPanel>
    </div>
  );
}

function Header({ email }: { email: SentEmail }) {
  return (
    <>
      <p className="text-[11px] text-ink-muted">
        To:{" "}
        <span className="text-ink-secondary">
          {email.to.length === 0 ? "nobody" : email.to.join(", ")}
        </span>
      </p>
      <p className="mt-0.5 text-[13px] font-medium text-ink">{email.subject}</p>
    </>
  );
}

function CopyButton({
  email,
  notify,
}: {
  email: SentEmail;
  notify: (m: string, d?: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(`Subject: ${email.subject}\n\n${email.body ?? ""}`)
          .then(
            () => notify("Letter copied"),
            () => notify("Could not copy"),
          );
      }}
      className="ml-auto rounded border border-line-hair px-2.5 py-1 text-[11px] text-ink-secondary hover:border-line-strong hover:text-ink"
    >
      Copy
    </button>
  );
}
