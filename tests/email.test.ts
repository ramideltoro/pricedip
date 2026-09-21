import test from "node:test";
import assert from "node:assert/strict";
import { openDb, bootstrap, id, now } from "../server/db.js";
import { deliverEmail } from "../server/email.js";
test("email retries preserve idempotency and enforce the independent free-tier budget", async () => {
  const db = openDb(":memory:");
  const account = bootstrap(db, "fixture@example.com");
  const list: any = db
    .prepare("SELECT id FROM watchlists WHERE owner=?")
    .get(account.id);
  const product = id(),
    event = id(),
    mail = id();
  db.prepare(
    "INSERT INTO products(id,list_id,title,url,retailer,target,created) VALUES(?,?,?,?,?,?,?)",
  ).run(
    product,
    list.id,
    "Fixture",
    "https://example.com/item",
    "ebay",
    100,
    now(),
  );
  db.prepare("INSERT INTO events VALUES(?,?,?,?,?)").run(
    event,
    product,
    90,
    100,
    now(),
  );
  db.prepare(
    "INSERT INTO outbox(id,event_id,next_attempt,created) VALUES(?,?,?,?)",
  ).run(mail, event, now(), now());
  const original = {
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
    limit: process.env.EMAIL_DAILY_LIMIT,
  };
  process.env.RESEND_API_KEY = "isolated-fixture";
  process.env.EMAIL_FROM = "fixture@example.com";
  const keys: string[] = [];
  const send: typeof fetch = async (_url, init) => {
    keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
    return new Response("{}", { status: keys.length === 1 ? 503 : 200 });
  };
  try {
    await deliverEmail(db, send);
    const pending: any = db.prepare("SELECT * FROM outbox").get();
    assert.equal(pending.status, "pending");
    assert.equal(pending.attempts, 1);
    assert(pending.next_attempt > now());
    await deliverEmail(db, send);
    assert.equal(keys.length, 1);
    db.prepare("UPDATE outbox SET next_attempt=?").run(now());
    await deliverEmail(db, send);
    assert.deepEqual(keys, ["pricedip-" + event, "pricedip-" + event]);
    assert.equal(
      (db.prepare("SELECT status FROM outbox").get() as any).status,
      "sent",
    );
    await deliverEmail(db, send);
    assert.equal(keys.length, 2);
    process.env.EMAIL_DAILY_LIMIT = "1";
    await deliverEmail(db, send);
    assert.equal(
      (
        db
          .prepare(
            "SELECT value FROM telemetry WHERE key='email_budget_exhausted'",
          )
          .get() as any
      ).value,
      1,
    );
  } finally {
    for (const [name, value] of Object.entries({
      RESEND_API_KEY: original.key,
      EMAIL_FROM: original.from,
      EMAIL_DAILY_LIMIT: original.limit,
    }))
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    db.close();
  }
});
