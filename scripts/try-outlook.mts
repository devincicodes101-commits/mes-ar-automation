/**
 * Sends ONE test email through Outlook, to an address you choose.
 *
 *   npm run try:outlook -- you@example.com
 *
 * Reads OUTLOOK_USER and OUTLOOK_PASSWORD from .env.local. It writes to the
 * address given on the command line and nothing else: it never reads tenants,
 * never touches the database and ignores MAIL_MODE, so it cannot email a real
 * customer.
 */
import { readFileSync } from "node:fs";
import nodemailer from "nodemailer";

import {
  outlookConfigFromEnv,
  outlookTransportOptions,
  plainOutlookError,
} from "../src/lib/mail/outlook-config.ts";

const env: Record<string, string> = { ...(process.env as Record<string, string>) };
try {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  /* no .env.local: fall back to the real environment */
}

const to = process.argv[2];
if (!to || !/^[^@\s]+@[^@\s]+$/.test(to)) {
  console.error("Give the address to send the test to: npm run try:outlook -- you@example.com");
  process.exit(1);
}

const cfg = outlookConfigFromEnv(env as NodeJS.ProcessEnv);
if ("error" in cfg) {
  console.error(cfg.error);
  process.exit(1);
}

console.log(`Signing in as ${cfg.user} on ${cfg.host}...`);
const transport = nodemailer.createTransport(outlookTransportOptions(cfg));

try {
  await transport.verify();
  console.log("Sign in worked.");
  const info = await transport.sendMail({
    from: `"${cfg.fromName}" <${cfg.user}>`,
    to,
    subject: "MES AR Automation - Outlook test",
    text:
      "This is a test from the MES AR Automation system, sent through Outlook.\n\n" +
      "If you can read this, the Outlook connection works.",
  });
  console.log(`Sent to ${to}. Message id: ${info.messageId}`);
} catch (e) {
  console.error("Failed: " + plainOutlookError((e as Error).message));
  process.exit(1);
}
