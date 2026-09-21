import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
export const now = () => Math.floor(Date.now() / 1000);
export const id = () => randomUUID();
export function openDb(
  filename = process.env.DB_PATH || "data/pricedip.sqlite",
) {
  if (filename !== ":memory:")
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY,applied INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,zip TEXT,radius INTEGER NOT NULL DEFAULT 25);
 CREATE TABLE IF NOT EXISTS watchlists(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES accounts(id),name TEXT NOT NULL,published INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS products(id TEXT PRIMARY KEY,list_id TEXT NOT NULL REFERENCES watchlists(id),title TEXT NOT NULL,url TEXT NOT NULL,retailer TEXT NOT NULL,target INTEGER NOT NULL,condition TEXT NOT NULL DEFAULT 'new',status TEXT NOT NULL DEFAULT 'pending',reason TEXT,last_checked INTEGER,last_success INTEGER,next_check INTEGER NOT NULL DEFAULT 0,armed INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,price INTEGER NOT NULL,currency TEXT NOT NULL,shipping INTEGER,availability TEXT NOT NULL,seller TEXT NOT NULL,evidence TEXT NOT NULL,observed INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS observations_product_time ON observations(product_id,observed);
 CREATE INDEX IF NOT EXISTS products_due ON products(active,next_check);
 CREATE TABLE IF NOT EXISTS research(product_id TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,brief TEXT NOT NULL,sources TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,product_id TEXT REFERENCES products(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,available INTEGER NOT NULL,lease_until INTEGER,created INTEGER NOT NULL,error TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS jobs_unique_active ON jobs(kind,product_id) WHERE status IN ('pending','running');
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,price INTEGER NOT NULL,target INTEGER NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,created INTEGER NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS flows(state TEXT PRIMARY KEY,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS telemetry(key TEXT PRIMARY KEY,value REAL NOT NULL);
 INSERT OR IGNORE INTO migrations VALUES(1,unixepoch());`);
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM migrations WHERE version=2").get()) {
      db.exec(`
      ALTER TABLE products ADD COLUMN identity TEXT;
      ALTER TABLE outbox ADD COLUMN sent_at INTEGER;
      CREATE INDEX IF NOT EXISTS outbox_due ON outbox(status,next_attempt);
      CREATE TABLE IF NOT EXISTS deployments(id TEXT PRIMARY KEY,kind TEXT NOT NULL,app TEXT NOT NULL,wiki TEXT,created INTEGER NOT NULL);
      INSERT INTO migrations VALUES(2,unixepoch());`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  return db;
}
export type Db = ReturnType<typeof openDb>;
export function metric(db: Db, key: string, value: number) {
  db.prepare(
    "INSERT INTO telemetry VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).run(key, value);
}
export function count(db: Db, key: string, by = 1) {
  db.prepare(
    "INSERT INTO telemetry VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=value+excluded.value",
  ).run(key, by);
}
export function enqueue(db: Db, kind: string, product: string) {
  db.prepare(
    "INSERT OR IGNORE INTO jobs(id,kind,product_id,available,created) VALUES(?,?,?,?,?)",
  ).run(id(), kind, product, now(), now());
}
export function claim(db: Db, kind?: string): any {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE jobs SET status='pending',lease_until=NULL WHERE status='running' AND lease_until<?",
    ).run(now());
    const job = db
      .prepare(
        "SELECT * FROM jobs WHERE status='pending' AND available<=? " +
          (kind ? "AND kind=? " : "") +
          "ORDER BY CASE WHEN kind='check' THEN 0 ELSE 1 END,created LIMIT 1",
      )
      .get(...(kind ? [now(), kind] : [now()]));
    if (job)
      db.prepare(
        "UPDATE jobs SET status='running',attempts=attempts+1,lease_until=? WHERE id=?",
      ).run(now() + 300, job.id);
    db.exec("COMMIT");
    return job;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function bootstrap(db: Db, email: string) {
  let a: any = db.prepare("SELECT * FROM accounts WHERE email=?").get(email);
  if (!a) {
    const account = id();
    db.prepare("INSERT INTO accounts(id,email) VALUES(?,?)").run(
      account,
      email,
    );
    db.prepare("INSERT INTO watchlists VALUES(?,?,?,1)").run(
      id(),
      account,
      "My watchlist",
    );
    a = db.prepare("SELECT * FROM accounts WHERE id=?").get(account);
  }
  return a;
}
