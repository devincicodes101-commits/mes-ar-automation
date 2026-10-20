"use client";

import { useMemo, useState } from "react";

import { checkEdit } from "@/lib/letter-edits";
import { LETTER_BODIES, fillWording, letterById, type LetterId } from "@/lib/letters";
import { authHeader, savedKey, type SavedEdit } from "@/lib/use-letter-edits";
import { useToast } from "@/lib/session";
import { Modal } from "@/components/ui";
import { formatDate } from "@/lib/data";

/**
 * Editing one tenant's letter, for the automatic run to send.
 *
 * What is saved here is what the 9am run sends to this tenant for this bill,
 * instead of MES's standard wording. Every letter nobody has edited is still
 * the standard wording with the usual figures. The screen says so in plain
 * words, on the screen, because an edit changes what a tenant is told about
 * money and nobody should be surprised that it applies by itself.
 *
 * The text is edited with its {{placeholders}} in it, and a preview shows it
 * filled in. The figures and dates are filled in on the day it goes, so an edit
 * cannot freeze a balance.
 */

const NAMES: Record<LetterId, string> = {
  "first-reminder": "First reminder",
  "final-notice": "Final notice",
};

export function LetterEditor({
  tenantId,
  companyName,
  billedOn,
  owed,
  sendOn,
  startAt,
  edits,
  canEdit,
  onSaved,
  onClose,
}: {
  tenantId: string;
  companyName: string;
  /** The bill this letter is about, ISO. An edit belongs to this bill only. */
  billedOn: string;
  /** What they owe, for the preview. */
  owed: number;
  /** When each letter goes, ISO, for the dates in the preview. */
  sendOn: Record<LetterId, string | null>;
  startAt: LetterId;
  edits: Map<string, SavedEdit>;
  canEdit: boolean;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { notify } = useToast();
  const [stage, setStage] = useState<LetterId>(startAt);
  const saved = edits.get(savedKey(tenantId, stage, billedOn)) ?? null;

  const standardSubject = letterById(stage).subject;
  const standardBody = LETTER_BODIES[stage];
  /* An edit's words only reach people allowed to edit. Anyone else sees the
     standard wording, and the notice that it has been edited. */
  const inEffectSubject = saved?.subject ?? standardSubject;
  const inEffectBody = saved?.body ?? standardBody;

  const [subject, setSubject] = useState(inEffectSubject);
  const [body, setBody] = useState(inEffectBody);
  const [busy, setBusy] = useState(false);

  /* Switching letters swaps the words in, rather than keeping the other's. */
  function pick(next: LetterId) {
    const s = edits.get(savedKey(tenantId, next, billedOn)) ?? null;
    setStage(next);
    setSubject(s?.subject ?? letterById(next).subject);
    setBody(s?.body ?? LETTER_BODIES[next]);
  }

  const preview = useMemo(
    () =>
      fillWording(stage, body, {
        companyName,
        grandTotal: owed,
        sentOn: sendOn[stage] ?? billedOn,
      }),
    [stage, body, companyName, owed, sendOn, billedOn],
  );

  const problem = checkEdit(subject, body);
  const unchanged = subject === inEffectSubject && body === inEffectBody;

  async function save() {
    setBusy(true);
    try {
      const r = await fetch("/api/letter-edits", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ tenantId, stage, billedOn, subject, body }),
      });
      const res = (await r.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        notify("Not saved", res.error ?? "The letter could not be saved.");
        return;
      }
      notify(
        `${NAMES[stage]} saved for ${companyName}`,
        "The automatic run will send this version to them.",
      );
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    try {
      const q = new URLSearchParams({ tenantId, stage, billedOn });
      const r = await fetch(`/api/letter-edits?${q.toString()}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      const res = (await r.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        notify("Not changed", res.error ?? "The letter could not be put back.");
        return;
      }
      setSubject(standardSubject);
      setBody(standardBody);
      notify(
        `${NAMES[stage]} for ${companyName} is back to the standard wording`,
        "The automatic run will send MES's standard letter.",
      );
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal wide title={`Edit the automatic letter · ${companyName}`} onClose={onClose}>
      <div className="space-y-4">
        {/* The disclaimer. Said before anything else, because it changes what
            happens without anybody pressing send. */}
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-relaxed text-amber-900">
          <p className="font-semibold">Please note</p>
          <p className="mt-0.5">
            Once you save, the <b>automatic 9am run will send this wording</b> to {companyName}{" "}
            instead of the standard letter, for the bill dated {formatDate(billedOn)} only. Letters nobody
            has edited are sent as standard. The balance, the dates and the company name are
            filled in on the day it goes, so leave the words in double braces as they are.
          </p>
        </div>

        {saved ? (
          <div className="rounded border border-accent bg-surface-alt px-3 py-2 text-xs text-ink">
            <b>This letter has been edited.</b> The automatic run will send the edited version
            to {companyName}. Saved{" "}
            {new Date(saved.editedAt).toLocaleString("en-SG")}.
            {!canEdit || saved.body === undefined
              ? " You can see that it was changed but not the words."
              : ""}
          </div>
        ) : null}

        <div className="flex gap-1.5" role="tablist" aria-label="Which letter">
          {(["first-reminder", "final-notice"] as const).map((id) => {
            const isEdited = edits.has(savedKey(tenantId, id, billedOn));
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={stage === id}
                onClick={() => pick(id)}
                className={
                  stage === id
                    ? "rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink"
                    : "rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong"
                }
              >
                {NAMES[id]}
                {isEdited ? " · edited" : ""}
              </button>
            );
          })}
          <span className="ml-auto self-center text-[11px] text-ink-muted">
            goes {sendOn[stage] ?? "on its date"}
          </span>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">Subject</span>
          <input
            value={subject}
            disabled={!canEdit}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink disabled:opacity-60"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Letter. Words in double braces, like {"{{amount}}"}, are filled in for you.
          </span>
          <textarea
            value={body}
            disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink disabled:opacity-60"
          />
        </label>

        {problem ? <p className="text-xs text-red-700">{problem}</p> : null}

        <details className="rounded border border-line-hair">
          <summary className="cursor-pointer px-3 py-2 text-xs text-ink-secondary">
            Preview as {companyName} would receive it
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 pb-3 font-mono text-[11px] leading-relaxed text-ink">
            {preview}
          </pre>
        </details>

        <div className="flex flex-wrap items-center gap-2 border-t border-line-hair pt-4">
          {canEdit ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || unchanged || problem !== null}
              className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Saving..." : "Save for the automatic send"}
            </button>
          ) : null}
          {canEdit && saved ? (
            <button
              type="button"
              onClick={() => void reset()}
              disabled={busy}
              className="rounded border border-line-hair px-4 py-2 text-sm text-ink hover:border-line-strong disabled:opacity-40"
            >
              Back to the standard wording
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
