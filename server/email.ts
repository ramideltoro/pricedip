import { type Db, now, count, metric } from "./db.js";
export async function deliverEmail(db: Db, send: typeof fetch = fetch) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) return;
  const used: any = db
    .prepare(
      "SELECT sum(CASE WHEN coalesce(sent_at,created)>? THEN 1 ELSE 0 END) daily, count(*) monthly FROM outbox WHERE status='sent' AND coalesce(sent_at,created)>?",
    )
    .get(now() - 86400, now() - 31 * 86400);
  if (
    used.daily >= Number(process.env.EMAIL_DAILY_LIMIT || 30) ||
    used.monthly >= Number(process.env.EMAIL_MONTHLY_LIMIT || 500)
  ) {
    metric(db, "email_budget_exhausted", 1);
    return;
  }
  metric(db, "email_budget_exhausted", 0);
  const item: any = db
    .prepare(
      "SELECT o.*,e.price,e.target,p.title,p.url,a.email FROM outbox o JOIN events e ON e.id=o.event_id JOIN products p ON p.id=e.product_id JOIN watchlists w ON w.id=p.list_id JOIN accounts a ON a.id=w.owner WHERE o.status='pending' AND o.next_attempt<=? ORDER BY o.created LIMIT 1",
    )
    .get(now());
  if (!item) return;
  try {
    const r = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "pricedip-" + item.event_id,
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [item.email],
        subject: "PriceDip: " + item.title + " reached your target",
        text: `${item.title} is $${(item.price / 100).toFixed(2)}, below your $${(item.target / 100).toFixed(2)} target. Item price excludes shipping and tax.\n\n${item.url}\n\nhttps://pricedip.ramideltoro.com`,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("Email provider returned " + r.status);
    db.prepare(
      "UPDATE outbox SET status='sent',sent_at=unixepoch(),error=NULL WHERE id=?",
    ).run(item.id);
    count(db, "email_sent_total");
  } catch (e) {
    db.prepare(
      "UPDATE outbox SET attempts=attempts+1,next_attempt=?,error=? WHERE id=?",
    ).run(
      now() + Math.min(3600, 60 * 2 ** item.attempts),
      String(e).slice(0, 160),
      item.id,
    );
    count(db, "email_failures_total");
  }
}
