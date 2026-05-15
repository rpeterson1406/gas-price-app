import {
  getStationName as getTomTomStationName,
  getStationStreetAddress as getTomTomStationAddress
} from "../utils/stationDisplay.js";
import { datasetItemToStation, positionFromRow } from "../lib/apifyDatasetNormalize.js";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY;
const APIFY_DATASET_ID = String(import.meta.env.VITE_APIFY_DATASET_ID || "").trim();

const DEMO_PRICE_MIN = 3.15;
const DEMO_PRICE_MAX = 4.75;

/**
 * Gas prices: GET /api/gas-prices?zip= (Vite dev middleware or Vercel serverless).
 * The server uses APIFY_API_TOKEN + VITE_APIFY_DATASET_ID and Apify dataset items;
 * the browser never sees the token.
 */
if (import.meta.env.DEV) {
  console.info("[gasPriceAgent] Prices from same-origin /api/gas-prices (server fetches Apify).");
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Maps normalized API JSON back into the merge helper shape. */
function gasZipFromApiPayload(api) {
  const stations = Array.isArray(api.stations) ? api.stations : [];
  const rows = stations.map((s) => ({
    name: s.name,
    address: s.address,
    city: s.city,
    state: s.state,
    zip: s.zip,
    regularPrice: s.regularPrice,
    cashPrice: s.cashPrice,
    creditPrice: s.creditPrice,
    rating: s.rating
  }));
  const pricedRows = rows.filter(
    (r) => typeof r.regularPrice === "number" && Number.isFinite(r.regularPrice)
  );
  return {
    rows,
    pricedRows,
    zipAverageField:
      typeof api.averageRegular === "number" && Number.isFinite(api.averageRegular)
        ? api.averageRegular
        : null,
    raw: { items: Array.isArray(api.rawDatasetItems) ? api.rawDatasetItems : [] }
  };
}

async function fetchGasPricesForZip(zip) {
  if (!APIFY_DATASET_ID) {
    return {
      rows: [],
      pricedRows: [],
      zipAverageField: null,
      raw: { items: [] },
      zipFetchWarning: null
    };
  }
  try {
    const res = await fetch(`/api/gas-prices?zip=${encodeURIComponent(zip)}`, {
      headers: { Accept: "application/json" }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        rows: [],
        pricedRows: [],
        zipAverageField: null,
        raw: { items: [] },
        zipFetchWarning: null
      };
    }
    return gasZipFromApiPayload(data);
  } catch {
    return {
      rows: [],
      pricedRows: [],
      zipAverageField: null,
      raw: { items: [] },
      zipFetchWarning: null
    };
  }
}

function mean(nums) {
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

function demoPriceSeedHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic demo regular price per ZIP + station key (TomTom id / name / coords). */
function demoRegularPriceForStation(zip, stationKey) {
  const h = demoPriceSeedHash(`${zip}|${stationKey}`);
  const u = h / 0xffffffff;
  return round2(DEMO_PRICE_MIN + u * (DEMO_PRICE_MAX - DEMO_PRICE_MIN));
}

function findGasRowForTomTomName(gasRows, tomtomName) {
  const target = normalizeForMatch(tomtomName);
  if (!target || !gasRows.length) return null;

  for (const row of gasRows) {
    const n = normalizeForMatch(row.name);
    if (!n) continue;
    if (target.includes(n) || n.includes(target)) return row;
  }
  return null;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

async function fetchTomTomGasStationsNearPoint(lat, lon, radiusMeters) {
  if (!TOMTOM_KEY) {
    throw new Error("TomTom API key is missing.");
  }

  const r = Math.min(Math.max(Math.round(radiusMeters), 1000), 50000);
  const stationUrl = `https://api.tomtom.com/search/2/search/gas%20station.json?key=${encodeURIComponent(
    TOMTOM_KEY
  )}&lat=${lat}&lon=${lon}&radius=${r}&limit=25&countrySet=US`;

  const stationResponse = await fetch(stationUrl);
  if (!stationResponse.ok) {
    throw new Error(`TomTom gas station lookup failed. Status: ${stationResponse.status}`);
  }

  const stationData = await stationResponse.json();
  return stationData.results || [];
}

function mergeLiveTomTomWithApify(zip, tomtomStations, gasZip, liveBaseline) {
  const { rows: gasRows } = gasZip;
  const { pricedRows } = gasZip;

  let merged = tomtomStations.map((t) => {
    const name = getTomTomStationName(t);
    const address = getTomTomStationAddress(t);
    const match = findGasRowForTomTomName(gasRows, name);
    const regularPrice =
      typeof match?.regularPrice === "number" && Number.isFinite(match.regularPrice)
        ? match.regularPrice
        : liveBaseline;

    return {
      name,
      address,
      city: match?.city ?? null,
      state: match?.state ?? null,
      zip: match?.zip ?? null,
      regularPrice: round2(regularPrice),
      cashPrice: match?.cashPrice ?? null,
      creditPrice: match?.creditPrice ?? null,
      rating: match?.rating ?? null,
      position: t.position,
      id: t.id,
      isDemoEstimate: false
    };
  });

  if (!merged.length && pricedRows.length > 0) {
    const rawList = Array.isArray(gasZip.raw?.items) ? gasZip.raw.items : [];
    const pricedFromZip = rawList
      .map((orig) => {
        const s = datasetItemToStation(orig);
        return typeof s.regularPrice === "number" && Number.isFinite(s.regularPrice)
          ? { ...s, _raw: orig }
          : null;
      })
      .filter(Boolean);

    merged = pricedFromZip.map((r, i) => {
      const { _raw, ...rest } = r;
      return {
        ...rest,
        address: r.address || "Address not available",
        regularPrice: round2(r.regularPrice),
        position: positionFromRow(_raw),
        id: `apify-${zip}-${i}`,
        isDemoEstimate: false
      };
    });
  }

  return merged;
}

function mergeDemoStations(zip, tomtomStations, gasZip) {
  let merged = tomtomStations.map((t) => {
    const name = getTomTomStationName(t);
    const address = getTomTomStationAddress(t);
    const key = [t.id, name, t.position?.lat, t.position?.lon].filter((x) => x != null).join("|");
    const regularPrice = demoRegularPriceForStation(zip, key);
    return {
      name,
      address,
      city: null,
      state: null,
      zip,
      regularPrice,
      cashPrice: null,
      creditPrice: null,
      rating: null,
      position: t.position,
      id: t.id,
      isDemoEstimate: true
    };
  });

  if (merged.length) return merged;

  const rawList = Array.isArray(gasZip.raw?.items) ? gasZip.raw.items : [];
  let i = 0;
  for (const orig of rawList) {
    const pos = positionFromRow(orig);
    if (!pos) continue;
    const s = datasetItemToStation(orig);
    const key = [orig.id, s.name, s.zip, pos.lat, pos.lon].filter((x) => x != null).join("|");
    const regularPrice = demoRegularPriceForStation(zip, key);
    merged.push({
      name: s.name,
      address: s.address || "Address not available",
      city: s.city,
      state: s.state,
      zip: s.zip || zip,
      regularPrice,
      cashPrice: null,
      creditPrice: null,
      rating: s.rating,
      position: pos,
      id: `apify-demo-${zip}-${i++}`,
      isDemoEstimate: true
    });
  }

  return merged;
}

/**
 * Merges TomTom POIs with Apify dataset rows when available; otherwise demo estimates from TomTom (or Apify positions).
 */
function mergeGasDataIntoTomTomStations(zip, tomtomStations, gasZip) {
  const { pricedRows, zipAverageField } = gasZip;

  const hasLiveApify =
    pricedRows.length > 0 ||
    (typeof zipAverageField === "number" &&
      Number.isFinite(zipAverageField) &&
      zipAverageField > 0);

  const liveBaseline =
    (pricedRows.length ? mean(pricedRows.map((r) => r.regularPrice)) : null) ??
    (hasLiveApify && typeof zipAverageField === "number" && Number.isFinite(zipAverageField)
      ? zipAverageField
      : null);

  const useLive = hasLiveApify && liveBaseline != null;

  let merged = [];
  let pricingSource = "demo";

  if (useLive) {
    merged = mergeLiveTomTomWithApify(zip, tomtomStations, gasZip, liveBaseline);
    if (merged.length) {
      pricingSource = "live";
    }
  }

  if (!merged.length) {
    pricingSource = "demo";
    merged = mergeDemoStations(zip, tomtomStations, gasZip);
  }

  const stationPrices = merged.map((s) => s.regularPrice).filter((p) => Number.isFinite(p));
  let averagePrice =
    stationPrices.length > 0 ? round2(mean(stationPrices)) : null;
  if (averagePrice == null && pricingSource === "live" && liveBaseline != null) {
    averagePrice = round2(liveBaseline);
  }

  return {
    stations: merged,
    stationCount: merged.length,
    averagePrice,
    pricingSource
  };
}

async function fetchTomTomStations(zip) {
  if (!TOMTOM_KEY) {
    throw new Error("TomTom API key is missing.");
  }

  const keyQ = encodeURIComponent(TOMTOM_KEY);
  const zipQ = encodeURIComponent(zip);
  const structuredUrl = `https://api.tomtom.com/search/2/structuredGeocode.json?key=${keyQ}&countryCode=US&postalCode=${zipQ}`;

  let geocodeResponse = await fetch(structuredUrl);
  let geocodeData = geocodeResponse.ok ? await geocodeResponse.json() : null;

  if (!geocodeResponse.ok || !geocodeData?.results?.length) {
    const geocodeUrl = `https://api.tomtom.com/search/2/geocode/${zipQ}.json?key=${keyQ}&countrySet=US`;
    geocodeResponse = await fetch(geocodeUrl);
    if (!geocodeResponse.ok) {
      throw new Error("TomTom could not look up that ZIP code.");
    }
    geocodeData = await geocodeResponse.json();
  }

  if (!geocodeData.results || geocodeData.results.length === 0) {
    throw new Error("That ZIP code was not found for the United States.");
  }

  const lat = geocodeData.results[0].position.lat;
  const lon = geocodeData.results[0].position.lon;
  const stateCode = geocodeData.results[0]?.address?.countrySubdivision || "";

  const stations = await fetchTomTomGasStationsNearPoint(lat, lon, 10000);

  return {
    mapCenter: { lat, lon },
    tomtomStations: stations,
    stateCode
  };
}

export async function searchStationsInMapArea(zip, lat, lon, radiusMeters) {
  const [gasZip, tomtomStations] = await Promise.all([
    fetchGasPricesForZip(zip),
    fetchTomTomGasStationsNearPoint(lat, lon, radiusMeters)
  ]);

  return mergeGasDataIntoTomTomStations(zip, tomtomStations, gasZip);
}

export async function getaveragegasprice(zip) {
  if (!TOMTOM_KEY) {
    throw new Error("TomTom API key is missing. Add VITE_TOMTOM_API_KEY to your .env file.");
  }

  const [{ mapCenter, tomtomStations, stateCode }, gasZip] = await Promise.all([
    fetchTomTomStations(zip),
    fetchGasPricesForZip(zip)
  ]);

  const { stations, stationCount, averagePrice, pricingSource } =
    mergeGasDataIntoTomTomStations(zip, tomtomStations, gasZip);

  return {
    zip,
    averagePrice,
    stationCount,
    stations,
    mapCenter,
    stateCode,
    pricingSource
  };
}
