import { safeFetch } from "./fetcher.js";
import * as cheerio from "cheerio";
import { z } from "zod";
import { sources, sourceFor, requiresLocation } from "./policy.js";
import { extract, type Offer } from "./adapters.js";
export async function discover(
  query: string,
  zip?: string,
  radius = 25,
  filters: {
    source?: string;
    condition?: string;
    maxPrice?: number;
    seller?: string;
    delivery?: string;
  } = {},
) {
  const links = sources.map((s) => ({
    name: s.name,
    local: !!s.local,
    url:
      "https://www.google.com/search?q=" +
      encodeURIComponent(
        query + " site:" + s.host + (s.local && zip ? " near " + zip : ""),
      ),
    status:
      s.local && !zip
        ? "Set your ZIP code to search locally"
        : "Open retailer search",
  }));
  const q =
    query +
    (filters.source && sources.find((s) => s.id === filters.source)
      ? " site:" + sources.find((s) => s.id === filters.source)!.host
      : "") +
    (zip ? " near " + zip : "");
  try {
    const direct = /^https:\/\//.test(query) && sourceFor(query) ? query : null;
    if (!direct && !process.env.SEARXNG_URL)
      throw Error("Search service not configured");
    const u = new URL(
      "/search",
      process.env.SEARXNG_URL || "http://127.0.0.1:4352",
    );
    u.search = new URLSearchParams({
      q,
      format: "json",
      language: "en-US",
      safesearch: "1",
      categories: "general",
    }).toString();
    let j: any = { results: [{ url: direct }] };
    if (!direct) {
      const r = await fetch(u, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw Error("Search provider unavailable");
      j = await r.json();
    }
    const seen = new Set();
    const candidates = (j.results || [])
      .filter((x: any) => {
        try {
          const s = sourceFor(x.url);
          if (!s || (s.local && !zip) || seen.has(x.url)) return false;
          seen.add(x.url);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, 3);
    const offers: Offer[] = [];
    let excluded = 0;
    for (const c of candidates) {
      try {
        const o = await extract(c.url);
        if (
          o.eligible &&
          (!filters.source || o.source === filters.source) &&
          (!filters.condition || o.condition === filters.condition) &&
          (!filters.seller ||
            o.seller.name
              .toLowerCase()
              .includes(filters.seller.toLowerCase())) &&
          (!filters.delivery || o.delivery === filters.delivery) &&
          (!filters.maxPrice || o.price <= filters.maxPrice * 100) &&
          (!requiresLocation(o.url, o.delivery) ||
            (zip && (await withinRadius(zip, o, radius))))
        )
          offers.push(o);
        else excluded++;
      } catch {
        excluded++;
      }
    }
    return {
      offers,
      links,
      excluded,
      message: zip
        ? "Local listings require verified seller evidence and distance; unverified locations are excluded."
        : offers.length
          ? "Verified seller offers found."
          : "No qualifying offers found. Try an exact model or paste a product URL.",
      radius,
      searchAvailable: true,
    };
  } catch {
    return {
      offers: [],
      links,
      excluded: 0,
      message:
        "Automatic search is temporarily unavailable. Use the retailer search links or paste a listing URL.",
      searchAvailable: false,
    };
  }
}
export const Brief = z.object({
  summary: z.string().max(3000),
  specifications: z
    .array(z.object({ name: z.string().max(100), value: z.string().max(500) }))
    .max(20),
  pros: z.array(z.string().max(500)).max(8),
  cons: z.array(z.string().max(500)).max(8),
  alternatives: z.array(z.string().max(500)).max(5),
  sourceIds: z.array(z.number().int().min(0)).max(12),
});

const geoCache = new Map<string, { lat: number; lon: number }>();
async function geo(zip: string) {
  if (!/^\d{5}$/.test(zip)) throw Error("Invalid ZIP");
  if (geoCache.has(zip)) return geoCache.get(zip)!;
  const r = await fetch("https://api.zippopotam.us/us/" + zip, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw Error("ZIP lookup unavailable");
  const j: any = await r.json();
  const v = {
    lat: Number(j.places[0].latitude),
    lon: Number(j.places[0].longitude),
  };
  geoCache.set(zip, v);
  return v;
}
export async function withinRadius(zip: string, offer: Offer, radius: number) {
  try {
    const a = await geo(zip);
    const b = offer.postalCode
      ? await geo(offer.postalCode)
      : { lat: offer.latitude, lon: offer.longitude };
    if (b.lat === undefined || b.lon === undefined) return false;
    const rad = (n: number) => (n * Math.PI) / 180;
    const dlat = rad(b.lat - a.lat),
      dlon = rad(b.lon - a.lon);
    const h =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlon / 2) ** 2;
    return 3959 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) <= radius;
  } catch {
    return false;
  }
}
export async function researchSources(
  title: string,
  url: string,
  description: string,
) {
  const evidence = [{ id: 0, url, title, text: description }];
  if (!process.env.SEARXNG_URL) return evidence;
  try {
    const u = new URL("/search", process.env.SEARXNG_URL);
    u.search = new URLSearchParams({
      q: title + " specifications review",
      format: "json",
      language: "en-US",
    }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j: any = await r.json();
    for (const item of (j.results || []).slice(0, 4)) {
      try {
        const html = await safeFetch(item.url);
        const $ = cheerio.load(html);
        $("script,style,nav,footer,header,iframe").remove();
        const text = (
          $("article").text() ||
          $("main").text() ||
          $("body").text()
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000);
        if (text.length > 100)
          evidence.push({
            id: evidence.length,
            url: item.url,
            title: String(item.title).slice(0, 200),
            text,
          });
      } catch {}
    }
  } catch {}
  return evidence;
}
