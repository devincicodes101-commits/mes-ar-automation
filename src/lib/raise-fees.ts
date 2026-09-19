/**
 * Raising the S$100 late fee from a screen, rather than writing down that it
 * was raised.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists
 *
 * The Late Payment Fees screen had a button that said "Raise the fees" and a
 * toast that said three had been raised for three hundred dollars. It called
 * recordExport(), which appends one line to the browser's own activity log.
 * No tenant was charged. The only thing that has ever written a late fee is
 * the scheduled run on the 16th.
 *
 * That is the same fault the reminder screen had, and it is worse here in one
 * way: an officer could press it, read the confirmation, and tell the client
 * the month's fees were done.
 *
 * ---------------------------------------------------------------------------
 * The server decides, and the database refuses
 *
 * A fee is money on a tenant's account, so the row is built on the server from
 * the rule and the report date rather than accepted from the browser. And
 * late_fees is unique on the tenant and the month, so a second attempt — a
 * second press, a rerun, or the schedule having already charged them at 09:00
 * — is ignored rather than charging them twice.
 *
 * That guarantee is not new and is not taken on trust: it is the same
 * constraint the scheduled run relies on, and running the 16th twice was
 * confirmed against the live database to leave three rows, not six.
 */

export interface FeeToRaise {
  tenantId: string;
  companyName: string;
  /** The month it belongs to, as the first of it. */
  period: string;
  amount: number;
}

export interface RaiseOutcome {
  raised: number;
  failed: number;
  title: string;
  detail: string;
}

/** The Supabase access token, the same way the other calls get it. */
async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("./supabase.ts");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function one(fee: FeeToRaise): Promise<string | null> {
  try {
    const r = await fetch("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeader()) },
      body: JSON.stringify({
        kind: "late-fee",
        record: { tenantId: fee.tenantId, period: fee.period, amount: fee.amount },
      }),
    });
    if (r.ok) return null;
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? `The server answered ${r.status}.`;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Raises each fee, and says what actually happened.
 *
 * Never throws. A screen that cannot reach the server has to tell somebody
 * that nothing was charged, and an exception thrown into a click handler is
 * how that message gets lost.
 */
export async function raiseFees(fees: FeeToRaise[]): Promise<RaiseOutcome> {
  if (fees.length === 0) {
    return { raised: 0, failed: 0, title: "Nothing to raise", detail: "No tenant is due a fee." };
  }

  let raised = 0;
  const problems: { company: string; why: string }[] = [];

  /*
   * One at a time. A batch insert would be faster and would report one error
   * for the whole month, leaving nobody able to say which tenants were
   * charged — which is exactly the question asked when something goes wrong
   * half way through.
   */
  for (const fee of fees) {
    const problem = await one(fee);
    if (problem) problems.push({ company: fee.companyName, why: problem });
    else raised += 1;
  }

  const money = fees
    .filter((_, i) => i < raised)
    .reduce((n, f) => n + f.amount, 0);

  if (raised === 0) {
    return {
      raised: 0,
      failed: problems.length,
      title: "No fee was raised",
      detail: problems[0]
        ? `${problems[0].company}: ${problems[0].why}`
        : "The server refused them all.",
    };
  }

  if (problems.length === 0) {
    return {
      raised,
      failed: 0,
      title: `${raised} late payment ${raised === 1 ? "fee" : "fees"} raised`,
      detail: `SGD ${money.toFixed(2)} charged, and recorded against each tenant.`,
    };
  }

  return {
    raised,
    failed: problems.length,
    title: `${raised} raised, ${problems.length} not`,
    detail: `${problems[0]!.company}: ${problems[0]!.why}`,
  };
}
