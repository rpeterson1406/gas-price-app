import {
  getStationName as getTomTomStationName,
  getStationStreetAddress as getTomTomStationAddress
} from "../utils/stationDisplay.js";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY;

const DEMO_PRICE_MIN = 3.15;
const DEMO_PRICE_MAX = 4.75;

/**
 * Gas prices are deterministic demo estimates generated from nearby TomTom stations.
 * Apify is not called for gas pricing.
 */
if (import.meta.env.DEV) {
  console.info("[gasPriceAgent] Using demo estimated gas prices; Apify pricing is disabled.");
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

function mergeDemoStations(zip, tomtomStations) {
  return tomtomStations.map((t) => {
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
}

/**
 * Adds deterministic demo estimates to TomTom POIs.
 */
function mergeGasDataIntoTomTomStations(zip, tomtomStations) {
  const merged = mergeDemoStations(zip, tomtomStations);
  const stationPrices = merged.map((s) => s.regularPrice).filter((p) => Number.isFinite(p));
  const averagePrice = stationPrices.length > 0 ? round2(mean(stationPrices)) : null;

  return {
    stations: merged,
    stationCount: merged.length,
    averagePrice,
    pricingSource: "demo"
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
  const tomtomStations = await fetchTomTomGasStationsNearPoint(lat, lon, radiusMeters);

  return mergeGasDataIntoTomTomStations(zip, tomtomStations);
}

export async function getaveragegasprice(zip) {
  if (!TOMTOM_KEY) {
    throw new Error("TomTom API key is missing. Add VITE_TOMTOM_API_KEY to your .env file.");
  }

  const { mapCenter, tomtomStations, stateCode } = await fetchTomTomStations(zip);

  const { stations, stationCount, averagePrice, pricingSource } =
    mergeGasDataIntoTomTomStations(zip, tomtomStations);

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
