import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { openDb, bootstrap, id, now, enqueue, claim } from "../server/db.js";
import { checkDependencies } from "../server/dependencies.js";
test("Qwen and search outages stay degraded while collection remains claimable", async () => {
  const db = openDb(":memory:"),
    a = bootstrap(db, "fixture@example.com");
  const list: any = db
      .prepare("SELECT id FROM watchlists WHERE owner=?")
      .get(a.id),
    p = id();
  db.prepare(
    "INSERT INTO products(id,list_id,title,url,retailer,target,created) VALUES(?,?,?,?,?,?,?)",
  ).run(p, list.id, "Fixture", "https://example.com", "ebay", 100, now());
  enqueue(db, "research", p);
  enqueue(db, "check", p);
  await checkDependencies(db, async () => {
    throw Error("Simulated dependency outage");
  });
  assert.equal(
    (
      db
        .prepare("SELECT value FROM telemetry WHERE key='qwen_available'")
        .get() as any
    ).value,
    0,
  );
  assert.equal(claim(db).kind, "check");
  await checkDependencies(
    db,
    async (url) =>
      new Response(
        JSON.stringify(
          String(url).endsWith("tags")
            ? { models: [{ name: "qwen2.5:3b" }] }
            : {},
        ),
        { status: 200 },
      ),
  );
  assert.equal(
    (
      db
        .prepare("SELECT value FROM telemetry WHERE key='qwen_available'")
        .get() as any
    ).value,
    1,
  );
  db.close();
});
test("a stale documentation fingerprint prevents release generation", () => {
  const dir = mkdtempSync(os.tmpdir() + "/pricedip-docs-");
  try {
    writeFileSync(
      dir + "/contract.json",
      JSON.stringify({ sourceFingerprint: "stale", reviewedGuides: [] }),
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/docs.mjs", "release", dir],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Documentation does not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
