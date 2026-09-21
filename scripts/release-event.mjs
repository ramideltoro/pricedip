import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
const release = JSON.parse(
  fs.readFileSync("/opt/pricedip/current/release.json", "utf8"),
);
const db = new DatabaseSync(
  process.env.DB_PATH || "/var/lib/pricedip/pricedip.sqlite",
);
db.exec(
  "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,kind TEXT NOT NULL,app TEXT NOT NULL,wiki TEXT,created INTEGER NOT NULL)",
);
const kind = process.argv[2] === "rollback" ? "rollback" : "deployment";
db.prepare("INSERT INTO deployments VALUES(?,?,?,?,unixepoch())").run(
  randomUUID(),
  kind,
  release.app,
  release.wiki,
);
db.prepare(
  "INSERT INTO telemetry VALUES(?,unixepoch()) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
).run(kind + "_timestamp");
db.close();
console.log(kind + " recorded: " + release.app);
