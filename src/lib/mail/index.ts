import "server-only";

import { gmailConfigFromEnv, gmailConnector } from "./gmail.ts";
import {
  allowlistFromEnv,
  modeFromEnv,
  type Letter,
  type MailConnector,
  type SendOutcome,
} from "./connector.ts";

export type { Letter, MailConnector, SendOutcome } from "./connector.ts";
export { mayLeave, modeFromEnv, allowlistFromEnv } from "./connector.ts";

/**
 * Which mailbox is carrying letters today.
 *
 * One place that chooses, so nothing else has to know a provider exists.
 * Gmail is the only one built; Outlook goes here beside it when MES ask for
 * it, and nothing above this file changes.
 */

export type Chosen =
  | { ok: true; connector: MailConnector }
  | { ok: false; error: string };

export function connector(env: NodeJS.ProcessEnv = process.env): Chosen {
  const provider = (env.MAIL_PROVIDER ?? "gmail").trim().toLowerCase();

  if (provider === "gmail") {
    const config = gmailConfigFromEnv(env);
    if ("error" in config) return { ok: false, error: config.error };
    return { ok: true, connector: gmailConnector(config) };
  }

  return {
    ok: false,
    error: `MAIL_PROVIDER is "${provider}", and only "gmail" is built so far.`,
  };
}

/**
 * What the system will and will not do right now, in words.
 *
 * Read by the settings screen and by the send route, so the answer to "why did
 * nothing go out" is on screen rather than in a log somebody has to be told to
 * look at. A system that silently sends nothing looks exactly like a system
 * that is working.
 */
export function sendingStatus(env: NodeJS.ProcessEnv = process.env): {
  mode: ReturnType<typeof modeFromEnv>;
  provider: string;
  ready: boolean;
  allowlist: string[];
  explanation: string;
} {
  const mode = modeFromEnv(env);
  const chosen = connector(env);
  const allowlist = allowlistFromEnv(env);

  const explanation =
    mode === "off"
      ? "Nothing is sent. Letters are written and recorded, and no mail leaves."
      : !chosen.ok
        ? `Sending is switched on but the mailbox is not usable: ${chosen.error}`
        : mode === "allowed"
          ? allowlist.length === 0
            ? "Sending is limited to a test list, and the list is empty, so nothing can go out. Set MAIL_ALLOWLIST."
            : `Only these addresses can be written to: ${allowlist.join(", ")}.`
          : "Letters go to real tenants at the addresses on their account.";

  return {
    mode,
    provider: (env.MAIL_PROVIDER ?? "gmail").toLowerCase(),
    ready: mode !== "off" && chosen.ok,
    allowlist,
    explanation,
  };
}

/**
 * Sends one letter, whatever is carrying it.
 *
 * Every caller goes through here rather than reaching for a provider, so the
 * day MES nominate a mailbox there is one line to change.
 */
export async function send(letter: Letter, env: NodeJS.ProcessEnv = process.env): Promise<SendOutcome> {
  const chosen = connector(env);
  if (!chosen.ok) {
    // Blocked rather than failed: nothing was attempted, and retrying without
    // fixing the configuration would do the same thing again.
    return { sent: false, reason: chosen.error, blocked: true };
  }
  return chosen.connector.send(letter);
}
