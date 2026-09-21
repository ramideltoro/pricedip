import { metric, type Db } from "./db.js";
export async function checkDependencies(db: Db, request: typeof fetch = fetch) {
  try {
    const r = await request(
      (process.env.OLLAMA_URL || "http://127.0.0.1:11434") + "/api/tags",
      { signal: AbortSignal.timeout(5000) },
    );
    const j: any = await r.json();
    metric(
      db,
      "qwen_available",
      r.ok &&
        j.models?.some(
          (m: any) => m.name === (process.env.QWEN_MODEL || "qwen2.5:3b"),
        )
        ? 1
        : 0,
    );
  } catch {
    metric(db, "qwen_available", 0);
  }
  try {
    const r = await request(
      (process.env.SEARXNG_URL || "http://127.0.0.1:4352") + "/healthz",
      { signal: AbortSignal.timeout(5000) },
    );
    metric(db, "search_available", r.ok ? 1 : 0);
  } catch {
    metric(db, "search_available", 0);
  }
}
