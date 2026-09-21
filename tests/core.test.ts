import test from "node:test";
import assert from "node:assert/strict";
import { openDb, bootstrap, id, now, enqueue, claim } from "../server/db.js";
import { sellerEligibility, qualifies } from "../server/policy.js";
import { publicIP } from "../server/fetcher.js";
import { recordOffer } from "../server/tracking.js";
import { parseOffer } from "../server/adapters.js";
import type { Offer } from "../server/adapters.js";
const seller = {
  name: "Example",
  evidenceUrl: "https://www.ebay.com/itm/12345678901",
  verifiedAt: now(),
};
test("seller reputation fails closed at exact thresholds", () => {
  assert.equal(
    sellerEligibility("ebay", { ...seller, positive: 99, feedback: 100 })
      .eligible,
    true,
  );
  assert.equal(
    sellerEligibility("ebay", { ...seller, positive: 98.9, feedback: 1000 })
      .eligible,
    false,
  );
  assert.equal(
    sellerEligibility("offerup", { ...seller, rating: 4.5, reviews: 20 })
      .eligible,
    true,
  );
  assert.equal(
    sellerEligibility("offerup", { ...seller, rating: 5, reviews: 19 })
      .eligible,
    false,
  );
  assert.equal(sellerEligibility("amazon", { ...seller }).eligible, false);
});
test("SSRF blocks loopback, LAN, link-local and mapped IPv6", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.1.1",
    "192.168.1.77",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
  ])
    assert.equal(publicIP(ip), false, ip);
  assert.equal(publicIP("8.8.8.8"), true);
});
test("price crossing is strict and excludes conditional/auction offers", () => {
  assert.equal(qualifies(999, 1000, "in_stock", "USD"), true);
  for (const args of [
    [1000, 1000, "in_stock", "USD"],
    [900, 1000, "unknown", "USD"],
    [900, 1000, "in_stock", "EUR"],
    [900, 1000, "in_stock", "USD", true],
    [900, 1000, "in_stock", "USD", false, true],
  ] as any[])
    assert.equal((qualifies as any)(...args), false);
});
test("retailer hostname alone does not confer seller trust", () => {
  const html = (s: any) =>
    '<script type="application/ld+json">' +
    JSON.stringify({
      "@type": "Product",
      name: "Headphones",
      offers: {
        "@type": "Offer",
        price: "20",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
        seller: { name: s },
      },
    }) +
    "</script>";
  assert.equal(
    parseOffer(html("Unknown seller"), "https://www.walmart.com/ip/123")
      .eligible,
    false,
  );
  assert.equal(
    parseOffer(html("Walmart"), "https://www.walmart.com/ip/123").eligible,
    true,
  );
});
test("durable leases recover, observations persist, alerts deduplicate and rearm", () => {
  const db = openDb(":memory:");
  const a = bootstrap(db, "owner@example.com");
  const list: any = db
    .prepare("SELECT id FROM watchlists WHERE owner=?")
    .get(a.id);
  const pid = id();
  db.prepare(
    "INSERT INTO products(id,list_id,title,url,retailer,target,created) VALUES(?,?,?,?,?,?,?)",
  ).run(pid, list.id, "Product", "https://example.com", "ebay", 1000, now());
  let p: any = db.prepare("SELECT * FROM products WHERE id=?").get(pid);
  const offer: Offer = {
    title: "Product",
    price: 900,
    currency: "USD",
    shipping: null,
    availability: "in_stock",
    condition: "new",
    seller: { ...seller, positive: 99, feedback: 100 },
    eligible: true,
    reason: "ok",
    conditional: false,
    auction: false,
    source: "ebay",
    url: p.url,
    description: "",
  };
  recordOffer(db, p, offer);
  recordOffer(db, p, offer);
  assert.equal((db.prepare("SELECT count(*) n FROM events").get() as any).n, 1);
  recordOffer(db, p, { ...offer, price: 1100 });
  recordOffer(db, p, offer);
  assert.equal((db.prepare("SELECT count(*) n FROM events").get() as any).n, 2);
  assert.equal((db.prepare("SELECT count(*) n FROM outbox").get() as any).n, 2);
  enqueue(db, "check", pid);
  enqueue(db, "check", pid);
  const j = claim(db);
  assert.ok(j);
  assert.equal(claim(db), undefined);
  db.prepare("UPDATE jobs SET lease_until=? WHERE id=?").run(now() - 1, j.id);
  assert.equal(claim(db).id, j.id);
  db.close();
});
test("manufacturer storefronts qualify, ambiguous variants do not", () => {
  const product = {
    "@type": "Product",
    name: "Model A",
    offers: {
      "@type": "Offer",
      price: 30,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  const html = (x: any) =>
    '<script type="application/ld+json">' + JSON.stringify(x) + "</script>";
  assert.equal(
    parseOffer(html(product), "https://electronics.sony.com/audio/p/test")
      .eligible,
    true,
  );
  assert.throws(
    () =>
      parseOffer(
        html([product, { ...product, name: "Model B" }]),
        "https://www.bestbuy.com/product/test",
      ),
    /Multiple product variants/,
  );
});
