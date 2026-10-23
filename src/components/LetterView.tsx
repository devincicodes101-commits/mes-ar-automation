"use client";

import { useMemo } from "react";
import type { SentEmail } from "@/lib/store";
import { useToast } from "@/lib/session";
import { ScrollPanel, StatusBadge, Tag } from "@/components/ui";
import { formatDateTime } from "@/lib/format";

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
        <div className="border-b border-line-hair px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <Tag>{email.templateName}</Tag>
            <span className="text-[11px] text-ink-muted">
              {formatDateTime(email.at)}
            </span>
            {email.simulated ? (
              <StatusBadge kind="critical" label="Not sent" />
            ) : (
              <StatusBadge kind="good" label="Sent" />
            )}
            <CopyButton email={email} notify={notify} />
          </div>
          <Header email={email} />
        </div>
      ) : (
        <div className="border-b border-line-hair px-5 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Tag>{email.templateName}</Tag>
            <span className="text-[11px] text-ink-muted">
              {formatDateTime(email.at)}
            </span>
            {email.simulated ? (
              <StatusBadge kind="critical" label="Not sent" />
            ) : (
              <StatusBadge kind="good" label="Sent" />
            )}
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
              Only the subject and recipients were kept for this letter.
            </p>
          ) : null}
        </div>
      ) : null}

      <ScrollPanel max={compact ? 440 : 420} className="bg-surface-alt p-3 sm:p-5">
        <div className="mx-auto max-w-2xl rounded-md border border-line-hair bg-surface px-5 py-5 shadow-sm sm:px-7 sm:py-6">
          <div className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-ink">
            {notCaptured
              ? "The text of this letter was not kept."
              : sentEmpty
                ? "(the letter was sent with no text)"
                : email.body}
          </div>
        </div>
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
