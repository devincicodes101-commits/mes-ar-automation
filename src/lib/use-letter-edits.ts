"use client";

import { useCallback, useEffect, useState } from "react";

import type { LetterId } from "./letters";

/**
 * The letters somebody has edited by hand, as the screens need them.
 *
 * Everybody signed in learns THAT a letter is edited, so a screen can say so.
 * Only people who may edit receive the words (the server decides, not this).
 */
export interface SavedEdit {
  tenantId: string;
  stage: LetterId;
  billedOn: string;
  editedAt: string;
  subject?: string;
  body?: string;
}

export const savedKey = (tenantId: string, stage: LetterId, billedOn: string) =>
  `${billedOn}|${stage}|${tenantId}`;

export async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("./supabase");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export function useLetterEdits() {
  const [edits, setEdits] = useState<Map<string, SavedEdit>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  /* False until the first answer, so an editor never opens on the standard
     letter while a saved one is still on its way. */
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/letter-edits", { headers: await authHeader() });
      const body = (await r.json()) as { ok?: boolean; edits?: SavedEdit[]; problem?: string | null };
      if (!r.ok || !body.ok) return;
      setProblem(body.problem ?? null);
      setEdits(new Map((body.edits ?? []).map((e) => [savedKey(e.tenantId, e.stage, e.billedOn), e])));
    } catch {
      /* No edits shown is the safe reading: the standard letters. */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { edits, loaded, problem, reload };
}
