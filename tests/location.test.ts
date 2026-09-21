import test from "node:test";
import assert from "node:assert/strict";
import { requiresLocation } from "../server/policy.js";
import { withinRadius } from "../server/search.js";
import type { Offer } from "../server/adapters.js";
test("national retailer pickup and local marketplaces require location; distance failures exclude offers", async () => {
  assert.equal(
    requiresLocation("https://www.bestbuy.com/product/fixture", "pickup"),
    true,
  );
  assert.equal(
    requiresLocation("https://www.bestbuy.com/product/fixture", "delivery"),
    false,
  );
  assert.equal(
    requiresLocation("https://www.facebook.com/marketplace/item/fixture"),
    true,
  );
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        places: [{ latitude: "40.7506", longitude: "-73.9972" }],
      }),
    );
  try {
    assert.equal(
      await withinRadius(
        "10001",
        { latitude: 40.75, longitude: -73.99 } as Offer,
        25,
      ),
      true,
    );
    assert.equal(
      await withinRadius(
        "10001",
        { latitude: 37.78, longitude: -122.39 } as Offer,
        25,
      ),
      false,
    );
    assert.equal(await withinRadius("10001", {} as Offer, 25), false);
    assert.equal(
      await withinRadius(
        "",
        { latitude: 40.75, longitude: -73.99 } as Offer,
        25,
      ),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
