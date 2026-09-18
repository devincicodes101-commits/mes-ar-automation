import "server-only";
import crypto from "node:crypto";

/**
 * The state parameter, signed.
 *
 * Google hands this back to the callback exactly as it was given, which means
 * anybody who can construct a URL can put anything in it. Unsigned, it would
 * be a claim about whose account is being connected, made by whoever sent the
 * request, and a stored refresh token filed against the wrong person is a
 * quiet way to send letters as somebody else.
 *
 * Signed with the service role key, which the server already holds and the
 * browser never sees. A separate secret would be one more thing to set with
 * no more safety.
 */

const secret = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** Ten minutes is long enough to approve a consent screen and no longer. */
const GOOD_FOR = 10 * 60 * 1000;

export interface State {
  userId: string;
  at: number;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");

function sign(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signState(state: State): string {
  const payload = b64(JSON.stringify(state));
  return `${payload}.${sign(payload)}`;
}

export function readState(value: string): State | { error: string } {
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return { error: "The sign in could not be matched to a request." };

  const expected = sign(payload);
  // Constant time, so the comparison does not leak the signature a character
  // at a time to somebody willing to measure.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { error: "The sign in could not be matched to a request." };
  }

  try {
    const state = JSON.parse(Buffer.from(payload, "base64url").toString()) as State;
    if (!state.userId) return { error: "The sign in named no account." };
    if (Date.now() - state.at > GOOD_FOR) {
      return { error: "That took too long. Start connecting again." };
    }
    return state;
  } catch {
    return { error: "The sign in could not be read." };
  }
}
