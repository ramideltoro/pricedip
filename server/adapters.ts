import { renderPage } from "./browser.js";
import * as cheerio from "cheerio";
import { safeFetch } from "./fetcher.js";
import { sellerEligibility, sourceFor, type Seller } from "./policy.js";
import { now } from "./db.js";
export type Offer = {
  title: string;
  price: number;
  currency: string;
  shipping: number | null;
  availability: string;
  condition: string;
  seller: Seller;
  eligible: boolean;
  reason: string;
  conditional: boolean;
  auction: boolean;
  source: string;
  url: string;
  description: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  identity?: string;
  delivery?: "pickup" | "delivery" | "unknown";
};
export function ebayCondition(value: unknown) {
  const condition = String(value || "");
  return /^(new|brand new)$/i.test(condition)
    ? "new"
    : /refurb/i.test(condition)
      ? "refurbished"
      : /^(used|pre-owned|open box)/i.test(condition)
        ? "used"
        : "unknown";
}
export function ebayAuction(options?: string[]) {
  return !options?.includes("FIXED_PRICE") || options.includes("AUCTION");
}
function flatten(x: any): any[] {
  if (Array.isArray(x)) return x.flatMap(flatten);
  if (x && typeof x === "object")
    return [
      x,
      ...Object.values(x).flatMap((v) =>
        typeof v === "object" ? flatten(v) : [],
      ),
    ];
  return [];
}
export function parseOffer(html: string, url: string): Offer {
  const source = sourceFor(url);
  if (!source) throw Error("Unsupported retailer");
  const $ = cheerio.load(html);
  if (/captcha|verify you are human|robot check/i.test($("title").text()))
    throw Error("Retailer verification required");
  let objects: any[] = [];
  $('script[type="application/ld+json"]').each((_, e) => {
    try {
      objects.push(...flatten(JSON.parse($(e).text())));
    } catch {}
  });
  const products = objects.filter(
    (x) =>
      x["@type"] === "Product" ||
      (Array.isArray(x["@type"]) && x["@type"].includes("Product")),
  );
  const matching = products.filter((x) => x.offers);
  if (matching.length > 1)
    throw Error(
      "Multiple product variants found; use an exact variant listing",
    );
  const p = matching[0];
  if (!p) throw Error("No verifiable product offer on this page");
  const offers = Array.isArray(p.offers) ? p.offers : [p.offers];
  const exact = offers.filter(
    (o: any) => o["@type"] !== "AggregateOffer" && o.price !== undefined,
  );
  if (exact.length !== 1)
    throw Error(
      "One exact purchasable offer is required; ranges and multiple variants are excluded",
    );
  const o = exact[0];
  const price = Math.round(Number(o.price) * 100);
  if (!Number.isSafeInteger(price) || price <= 0)
    throw Error("Invalid source price");
  const sellerName =
    typeof o.seller === "string"
      ? o.seller
      : o.seller?.name || (source.directStore ? source.name : "");
  const canonical: Record<string, RegExp> = {
    amazon: /^(amazon\.com|amazon)$/i,
    walmart: /^walmart(\.com)?$/i,
    bestbuy: /^best buy$/i,
    target: /^target(\.com)?$/i,
  };
  const seller: Seller = {
    name: sellerName,
    direct:
      source.directStore === true ||
      !!canonical[source.id]?.test(sellerName.trim()),
    evidenceUrl: url,
    verifiedAt: now(),
  };
  const rating = o.seller?.aggregateRating;
  if (rating) {
    seller.rating =
      Number(rating.bestRating || 5) === 5
        ? Number(rating.ratingValue)
        : undefined;
    seller.reviews = Number(rating.reviewCount || rating.ratingCount);
  }
  const policy = sellerEligibility(source.id, seller);
  return {
    title: String(p.name || "Product").slice(0, 240),
    price,
    currency: String(o.priceCurrency || ""),
    shipping:
      o.shippingDetails?.shippingRate?.currency === "USD" &&
      Number.isFinite(Number(o.shippingDetails.shippingRate.value))
        ? Math.round(Number(o.shippingDetails.shippingRate.value) * 100)
        : null,
    availability:
      o.priceValidUntil && new Date(o.priceValidUntil).getTime() < Date.now()
        ? "unavailable"
        : /InStock$/.test(o.availability || "")
          ? "in_stock"
          : /SoldOut|Discontinued/.test(o.availability || "")
            ? "sold"
            : /OutOfStock/.test(o.availability || "")
              ? "unavailable"
              : "unknown",
    condition: /Used/.test(o.itemCondition || "")
      ? "used"
      : /Refurbished/.test(o.itemCondition || "")
        ? "refurbished"
        : /NewCondition/.test(o.itemCondition || "")
          ? "new"
          : "unknown",
    seller,
    ...policy,
    conditional:
      !!o.priceSpecification?.validForMemberTier ||
      !!o.validForMemberTier ||
      !!(
        o.priceValidUntil && new Date(o.priceValidUntil).getTime() < Date.now()
      ),
    auction: false,
    source: source.id,
    url,
    delivery: o.shippingDetails
      ? "delivery"
      : o.availableAtOrFrom
        ? "pickup"
        : "unknown",
    identity: JSON.stringify({
      sku: p.sku || null,
      mpn: p.mpn || null,
      gtin: p.gtin || p.gtin13 || p.gtin12 || null,
      model: p.model || null,
      color: p.color || null,
      size: p.size || null,
    }),
    postalCode: o.availableAtOrFrom?.address?.postalCode,
    latitude: Number(o.availableAtOrFrom?.geo?.latitude) || undefined,
    longitude: Number(o.availableAtOrFrom?.geo?.longitude) || undefined,
    description: String(p.description || "")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 4000),
  };
}
export async function extract(url: string, browser = false): Promise<Offer> {
  const s = sourceFor(url);
  if (s?.id === "ebay" && new URL(url).searchParams.has("var"))
    throw Error(
      "This eBay variation URL requires explicit variation support; the default item will not be substituted",
    );
  if (
    s?.id === "ebay" &&
    process.env.EBAY_CLIENT_ID &&
    process.env.EBAY_CLIENT_SECRET
  ) {
    const item = new URL(url).pathname.match(/\/(\d{9,15})(?:\?|$|\/)/)?.[1];
    if (item) {
      const tokenResponse = await fetch(
        "https://api.ebay.com/identity/v1/oauth2/token",
        {
          method: "POST",
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(
                process.env.EBAY_CLIENT_ID +
                  ":" +
                  process.env.EBAY_CLIENT_SECRET,
              ).toString("base64"),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!tokenResponse.ok) throw Error("eBay production access unavailable");
      const token: any = await tokenResponse.json();
      const r = await fetch(
        "https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=" +
          item,
        {
          headers: {
            Authorization: "Bearer " + token.access_token,
            "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
          },
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!r.ok) throw Error("eBay listing unavailable");
      const j: any = await r.json();
      const seller: Seller = {
        name: j.seller?.username || "",
        positive: Number(j.seller?.feedbackPercentage),
        feedback: Number(j.seller?.feedbackScore),
        evidenceUrl: url,
        verifiedAt: now(),
      };
      return {
        title: j.title,
        price: Math.round(Number(j.price?.value) * 100),
        currency: j.price?.currency,
        shipping: j.shippingOptions?.[0]?.shippingCost
          ? Math.round(Number(j.shippingOptions[0].shippingCost.value) * 100)
          : null,
        availability: j.estimatedAvailabilities?.some(
          (a: any) => a.estimatedAvailabilityStatus === "IN_STOCK",
        )
          ? "in_stock"
          : "unknown",
        condition: ebayCondition(j.condition),
        seller,
        ...sellerEligibility("ebay", seller),
        conditional: false,
        auction: ebayAuction(j.buyingOptions),
        source: "ebay",
        url,
        delivery: j.shippingOptions?.length
          ? "delivery"
          : j.pickupOptions?.length
            ? "pickup"
            : "unknown",
        identity: JSON.stringify({
          itemId: j.itemId,
          conditionId: j.conditionId,
        }),
        description: String(j.shortDescription || "").slice(0, 4000),
      };
    }
  }
  try {
    return parseOffer(await safeFetch(url), url);
  } catch (e) {
    if (!browser || process.env.BROWSER_EXTRACTION !== "true") throw e;
    return parseOffer(await renderPage(url), url);
  }
}
