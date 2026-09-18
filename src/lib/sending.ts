/**
 * Whether this build may really send email.
 *
 * In a file of its own, carrying neither "use client" nor "server-only",
 * because both a screen and an API route have to read it. That is the same
 * reason roles.ts exists, and it is the same fault underneath.
 *
 * It lived in outbox.ts, which begins "use client". The activity route
 * imported it from there to decide whether a stored letter was a genuine send
 * or a dry run, and Next.js answers a server importing across that boundary
 * with a reference proxy rather than the value. A proxy is an object, an
 * object is truthy, and the route asks for the negation: every simulated
 * letter would have been recorded as really sent.
 *
 * That is the exact thing emails_sent.was_simulated was added to prevent. The
 * flag would have been wrong in the one direction that cannot be spotted
 * afterwards, and MES would have had a log saying they chased tenants they
 * never wrote to.
 */

/**
 * False, and not a setting.
 *
 * These letters go to MES's tenants. Turning this on is a decision that needs
 * a mailbox MES have nominated, addresses for the 181 clients who owe money
 * and have none, and somebody's explicit say so. It is a constant so that
 * nothing in a screen, a query string or an environment variable can flip it.
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
