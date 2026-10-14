import { GET as run } from "../route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The second daily cron: carry on with whatever the morning's run left.
 *
 * Its own address rather than /api/cron?continue=1, because a cron path in
 * vercel.json is safest without a query string. It is the same run in every
 * respect - the secret is checked there, and the letters already really sent
 * are skipped there - only marked as a follow-up, so it records over the day's
 * line and carries the earlier parts' letters forward.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  url.pathname = "/api/cron";
  url.searchParams.set("continue", "1");
  return run(new Request(url, { headers: request.headers }));
}
