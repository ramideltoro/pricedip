const sha = process.argv[2];
let ok = false;
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(
      "https://pricedip-wiki.ramideltoro.com/release.json?t=" + Date.now(),
      { signal: AbortSignal.timeout(10000) },
    );
    const j = await r.json();
    if (j.app === sha) {
      ok = true;
      break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 10000));
}
if (!ok) throw Error("Matching wiki publication was not confirmed");
console.log("Matching wiki is published");
