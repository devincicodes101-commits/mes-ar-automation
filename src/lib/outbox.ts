"use client";

import type { Account } from "./types";
import {
  type LetterId,
  type RenderedLetter,
  renderLetter,
} from "./letters.ts";

/**
 * The outbox, and the simulated send behind it.
 *
 * Nothing here touches the network, and that is structural rather than a
 * promise: there is no transport, no credential and no address to configure.
 * `simulateSend` builds the message, decides what would have happened, and
 * returns it. Wiring a real one in means adding a transport at the single
 * point marked below, and the day that happens the guard at the bottom of
 * this file has to be deleted deliberately.
 *
 * That matters more than usual here. These letters chase money, cite the
 * Employment of Foreign Manpower Regulations and threaten disruption of
 * services, and they go to real tenants of a real dormitory. A prototype that
 * could accidentally send one is a prototype that will.
 *
 * The simulation is honest about failure. A tenant with no address is not
 * quietly skipped: they come back as `blocked`, because the officer's
 * question is "who did not get this" and a screen that only shows successes
 * cannot answer it.
 */

export type DeliveryState = "simulated" | "blocked";

export interface OutboxMessage {
  id: string;
  accountId: string;
  customerCode: string;
  companyName: string;
  property: string;
  letterId: LetterId;
  letterName: string;
  subject: string;
  body: string;
  to: string[];
  /** What the tenant was told to pay by. */
  deadline: string;
  amount: number;
  state: DeliveryState;
  /** Why it was blocked, in words the officer can act on. */
  reason: string | null;
  at: string;
}

export interface SendPlan {
  letterId: LetterId;
  letterName: string;
  /** The AR report date. Both the letter's own date and the aging pivot. */
  sentOn: string;
  messages: OutboxMessage[];
  /** Everything that would have gone out. */
  sendable: OutboxMessage[];
  /** Everything that could not, and why. */
  blocked: OutboxMessage[];
  recipients: number;
  totalChased: number;
}

/* ------------------------------------------------------------ addressing */

/**
 * Who a reminder would actually reach.
 *
 * MES's contact list holds several addresses per company in one cell, and the
 * parser has already pulled them apart. All of them are used: the finance
 * mailbox and the named contact are both on the row because MES want both to
 * see it.
 */
export function recipientsFor(a: Account): string[] {
  return Array.from(new Set(a.emails.map((e) => e.trim().toLowerCase()))).filter(
    (e) => e !== "",
  );
}

/* ---------------------------------------------------------------- sending */

let counter = 0;

/**
 * Builds one message. Deterministic given the same inputs, so a simulation
 * can be re-run and diffed.
 */
export function buildMessage(
  account: Account,
  letterId: LetterId,
  sentOn: string,
): OutboxMessage {
  const to = recipientsFor(account);
  const letter: RenderedLetter = renderLetter(letterId, {
    companyName: account.companyName,
    grandTotal: account.total,
    sentOn,
  });

  counter += 1;
  const blocked = to.length === 0;

  return {
    id: `msg-${sentOn}-${letterId}-${String(counter).padStart(4, "0")}`,
    accountId: account.id,
    customerCode: account.customerCode,
    companyName: account.companyName,
    property: account.property,
    letterId,
    letterName: letter.name,
    subject: letter.subject,
    body: letter.body,
    to,
    deadline: letter.deadline,
    amount: account.total,
    state: blocked ? "blocked" : "simulated",
    reason: blocked
      ? "No email address on the contact list. Phone them instead."
      : null,
    at: sentOn,
  };
}

export interface SendOptions {
  /** Skip accounts in credit and accounts that owe nothing. */
  minimumBalance?: number;
  /** Leave out tenants who have moved out. */
  skipTerminated?: boolean;
}

/**
 * A bulk send, simulated.
 *
 * MES's Flow tab: "First Reminder - Bulk Email (Email List by Client Name &
 * email addresses captured in the system, create, edit and save option)".
 */
export function simulateSend(
  accounts: readonly Account[],
  letterId: LetterId,
  sentOn: string,
  opts: SendOptions = {},
): SendPlan {
  const minimumBalance = opts.minimumBalance ?? 0;
  counter = 0;

  const chosen = accounts
    .filter((a) => a.total > minimumBalance)
    .filter((a) => (opts.skipTerminated ? a.status !== "Terminated" : true))
    .sort((a, b) => b.total - a.total);

  const messages = chosen.map((a) => buildMessage(a, letterId, sentOn));
  const sendable = messages.filter((m) => m.state === "simulated");
  const blocked = messages.filter((m) => m.state === "blocked");

  return {
    letterId,
    letterName: messages[0]?.letterName ?? letterId,
    sentOn,
    messages,
    sendable,
    blocked,
    recipients: new Set(sendable.flatMap((m) => m.to)).size,
    totalChased: Math.round(sendable.reduce((n, m) => n + m.amount, 0) * 100) / 100,
  };
}

/* ------------------------------------------------------------------ guard */

/**
 * There is no transport in this build.
 *
 * Kept as a function rather than a comment so that anyone wiring a real
 * mailer has to come here and remove it, and so a test can assert that the
 * prototype cannot send. If this ever needs to become real, the credential
 * belongs in n8n on MES's own server, per section 8.4 of the proposal, and
 * the sending mailbox is theirs to nominate.
 */
export const CAN_SEND_FOR_REAL = false;

export function assertSimulationOnly(): void {
  if (CAN_SEND_FOR_REAL) {
    throw new Error(
      "Real sending is not configured, and must not be switched on in the " +
        "prototype. These letters go to MES's tenants.",
    );
  }
}
