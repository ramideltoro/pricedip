import fs from "node:fs";
const env = Object.fromEntries(
  fs
    .readFileSync("/etc/pricedip/runtime.env", "utf8")
    .split("\n")
    .filter((x) => x.includes("="))
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1).replace(/^["']|["']$/g, "")];
    }),
);
try {
  const r = await fetch("http://127.0.0.1:4350/internal/readyz", {
    headers: { authorization: "Bearer " + env.METRICS_TOKEN },
    signal: AbortSignal.timeout(3000),
  });
  const j = await r.json();
  if (!r.ok || !j.database || !j.worker || j.release.app !== process.argv[2])
    process.exit(1);
} catch {
  process.exit(1);
}
