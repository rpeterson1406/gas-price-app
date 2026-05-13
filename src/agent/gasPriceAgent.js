import {
  getStationName as getTomTomStationName,
  getStationStreetAddress as getTomTomStationAddress
} from "../utils/stationDisplay.js";

const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY;
const GAS_PRICE_KEY = String(import.meta.env.VITE_GAS_PRICE_API_KEY || "").trim();

/** US ZIP/station list — use this for US searches (generic `gasPrices` is often non-US and may error). */
const DEFAULT_GAS_USA_ZIP_URL = "https://api.collectapi.com/gasPrice/gasPricesUsa";
/** Legacy / non-US endpoint (tried after USA if custom URL not set). */
const LEGACY_GAS_ZIP_URL = "https://api.collectapi.com/gasPrice/gasPrices";
const ALL_USA_URL = "https://api.collectapi.com/gasPrice/allUsaPrice";

/** Maps TomTom's 2-letter US state code to full name for CollectAPI `allUsaPrice` rows. */
const US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming"
};

function collectApiHeaders() {
  return {
    authorization: `apikey ${GAS_PRICE_KEY}`,
    "content-type": "application/json"
  };
}

function parsePrice(val) {
  if (val == null) return null;
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const num = String(val).replace(/[$,]/g, "").trim();
  const f = parseFloat(num);
  return Number.isFinite(f) ? f : null;
}

/**
 * Pulls a "regular" unleaded price from one CollectAPI row.
 * Field names vary by endpoint and region, so we try several common keys.
 */
function extractRegularPrice(item) {
  if (!item || typeof item !== "object") return null;
  const keys = [
    "regular",
    "gasoline",
    "gasolineRegular",
    "unleaded",
    "price",
    "fuelPrice",
    "avgPrice",
    "average"
  ];
  for (const k of keys) {
    if (k in item) {
      const p = parsePrice(item[k]);
      if (p != null) return p;
    }
  }
  return null;
}

function firstResultArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  for (const k of ["result", "results", "data", "stations", "list"]) {
    if (Array.isArray(data[k])) return data[k];
  }
  return [];
}

function normalizeForMatch(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normStateLabel(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** CollectAPI sometimes returns `message` / `error` as objects; keep user-facing errors readable. */
function formatApiMessage(value, maxLen = 220) {
  if (value == null) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, maxLen);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => formatApiMessage(v, maxLen)).filter(Boolean);
    return parts.join("; ").slice(0, maxLen);
  }
  if (typeof value === "object") {
    const nested =
      formatApiMessage(value.message, maxLen) ||
      formatApiMessage(value.error, maxLen) ||
      formatApiMessage(value.msg, maxLen);
    if (nested) return nested;
    try {
      return JSON.stringify(value).replace(/\s+/g, " ").slice(0, maxLen);
    } catch {
      return "";
    }
  }
  return String(value).replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function assertCollectOk(data) {
  if (data && data.success === false) {
    const detail = formatApiMessage(data.message ?? data.error);
    throw new Error(
      detail ||
        "The gas price service returned an error. Check your API key, plan, and that this ZIP is supported."
    );
  }
}

/**
 * Turns a CollectAPI gasPrices row into { name, address, price } when possible.
 */
function collectRowToGasStation(row) {
  const name = String(
    row.name ||
      row.stationName ||
      row.station ||
      row.brand ||
      row.brandName ||
      "Gas station"
  ).trim();
  const address = String(
    row.address ||
      row.vicinity ||
      row.fullAddress ||
      row.street ||
      [row.streetNumber, row.streetName].filter(Boolean).join(" ") ||
      ""
  ).trim();
  const price = extractRegularPrice(row);
  return { name, address, price };
}

function positionFromGasRow(row) {
  const lat = row.lat ?? row.latitude ?? row?.position?.lat;
  const lon = row.lon ?? row.lng ?? row.longitude ?? row?.position?.lon;
  if (typeof lat === "number" && typeof lon === "number") return { lat, lon };
  return null;
}

/**
 * Reads JSON from CollectAPI and throws with a helpful message (status + API body) on failure.
 */
async function collectApiReadJson(url) {
  const res = await fetch(url, { headers: collectApiHeaders() });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const snippet = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(`Gas price API returned non-JSON (${res.status}): ${snippet}`);
  }
  if (!res.ok) {
    const apiMsg = data && (data.message ?? data.error ?? data.msg);
    const snippet = formatApiMessage(apiMsg || text || res.statusText, 220);
    throw new Error(`Gas price request failed (${res.status}): ${snippet}`);
  }
  return data;
}

function parseGasZipResponse(data) {
  assertCollectOk(data);
  let rows = firstResultArray(data)
    .map(collectRowToGasStation)
    .filter((r) => r.name.length > 0);

  const pricedSubset = rows
    .map((r) => r.price)
    .filter((p) => typeof p === "number" && Number.isFinite(p));

  const zipAverageField =
    parsePrice(data?.average) ??
    parsePrice(data?.avg) ??
    (pricedSubset.length ? mean(pricedSubset) : null);

  const pricedRows = rows.filter((r) => typeof r.price === "number" && Number.isFinite(r.price));

  return { rows, pricedRows, zipAverageField, raw: data };
}

/**
 * Calls CollectAPI for ZIP-level station prices (US).
 * Tries USA endpoint first, then legacy `gasPrices`, alternate zip param — ignores failures so
 * state-level `allUsaPrice` can still run.
 */
async function fetchGasPricesForZip(zip) {
  const urls = [];
  const custom = import.meta.env.VITE_GAS_PRICE_API_URL;

  if (custom && custom.includes("{zip}")) {
    urls.push(custom.replaceAll("{zip}", encodeURIComponent(zip)));
  } else if (custom) {
    const join = custom.includes("?") ? "&" : "?";
    urls.push(`${custom}${join}zipCode=${encodeURIComponent(zip)}`);
    urls.push(`${custom}${join}zip=${encodeURIComponent(zip)}`);
  } else {
    urls.push(
      `${DEFAULT_GAS_USA_ZIP_URL}?zipCode=${encodeURIComponent(zip)}`,
      `${DEFAULT_GAS_USA_ZIP_URL}?zip=${encodeURIComponent(zip)}`,
      `${LEGACY_GAS_ZIP_URL}?zipCode=${encodeURIComponent(zip)}`,
      `${LEGACY_GAS_ZIP_URL}?zip=${encodeURIComponent(zip)}`
    );
  }

  let lastError = null;
  for (const url of urls) {
    try {
      const data = await collectApiReadJson(url);
      const parsed = parseGasZipResponse(data);
      if (
        parsed.rows.length > 0 ||
        parsed.pricedRows.length > 0 ||
        parsed.zipAverageField != null
      ) {
        return parsed;
      }
    } catch (err) {
      lastError = err;
    }
  }

  return {
    rows: [],
    pricedRows: [],
    zipAverageField: null,
    raw: {},
    zipFetchWarning: lastError ? String(lastError.message) : null
  };
}

function mean(nums) {
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

/**
 * US state average regular price from CollectAPI allUsaPrice (fallback when ZIP list is empty).
 */
async function fetchStateRegularPrice(stateCode) {
  const data = await collectApiReadJson(ALL_USA_URL);
  assertCollectOk(data);
  const list = firstResultArray(data);
  const code = (stateCode || "").toUpperCase().trim();
  const fullState = US_STATE_NAMES[code] || "";

  for (const item of list) {
    const label = String(item.name || item.state || item.State || item.StateName || "").trim();
    if (!label) continue;
    const price = extractRegularPrice(item);
    if (price == null) continue;
    const labelNorm = normStateLabel(label);
    if (fullState && labelNorm === normStateLabel(fullState)) return price;
    if (label.toUpperCase() === code) return price;
    if (label.length === 2 && label.toUpperCase() === code) return price;
  }
  return null;
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

/**
 * TomTom POI search for gas stations around a point (used for ZIP search and map viewport refetch).
 */
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

/**
 * Merges TomTom POI results with CollectAPI ZIP/state pricing (shared by ZIP search and map refetch).
 */
async function mergeGasDataIntoTomTomStations(zip, tomtomStations, gasZip, stateCode) {
  const { rows: gasRows, pricedRows, zipAverageField } = gasZip;

  let baseline =
    (pricedRows.length ? mean(pricedRows.map((r) => r.price)) : null) ??
    zipAverageField ??
    null;

  if (baseline == null && stateCode) {
    baseline = await fetchStateRegularPrice(stateCode);
  }

  if (baseline == null) {
    throw new Error(
      "No regular gas price is available for this ZIP. Try another ZIP, or verify your gas price API key and that your plan includes US ZIP data."
    );
  }

  let merged = tomtomStations.map((t) => {
    const name = getTomTomStationName(t);
    const address = getTomTomStationAddress(t);
    const match = findGasRowForTomTomName(gasRows, name);
    const price =
      typeof match?.price === "number" && Number.isFinite(match.price)
        ? match.price
        : baseline;

    return {
      name,
      address,
      price: round2(price),
      position: t.position,
      id: t.id
    };
  });

  if (!merged.length && pricedRows.length > 0) {
    const rawList = firstResultArray(gasZip.raw);
    const pricedFromZip = rawList
      .map((orig) => {
        const s = collectRowToGasStation(orig);
        return typeof s.price === "number" && Number.isFinite(s.price)
          ? { ...s, _raw: orig }
          : null;
      })
      .filter(Boolean);

    merged = pricedFromZip.map((r, i) => ({
      name: r.name,
      address: r.address || "Address not available",
      price: round2(r.price),
      position: positionFromGasRow(r._raw),
      id: `collect-${zip}-${i}`
    }));
  }

  const stationPrices = merged.map((s) => s.price).filter((p) => Number.isFinite(p));
  const averagePrice = round2(
    stationPrices.length ? mean(stationPrices) : baseline
  );

  return {
    stations: merged,
    stationCount: merged.length,
    averagePrice
  };
}

/**
 * Fetches TomTom geocode + nearby gas POIs (locations for map and list addresses).
 */
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

/**
 * After the user pans/zooms the map, reload TomTom stations for the new center + radius
 * and re-merge with CollectAPI prices for the same ZIP.
 */
export async function searchStationsInMapArea(zip, lat, lon, radiusMeters, stateCode) {
  if (!GAS_PRICE_KEY) {
    throw new Error("Gas price API key is missing. Add VITE_GAS_PRICE_API_KEY to your .env file.");
  }

  const [gasZip, tomtomStations] = await Promise.all([
    fetchGasPricesForZip(zip),
    fetchTomTomGasStationsNearPoint(lat, lon, radiusMeters)
  ]);

  return mergeGasDataIntoTomTomStations(zip, tomtomStations, gasZip, stateCode);
}

/**
 * Main agent: TomTom for station locations, CollectAPI for real regular gas prices.
 * Returns the shape expected by App.jsx (plus mapCenter / ids / position for the map).
 */
export async function getaveragegasprice(zip) {
  if (!GAS_PRICE_KEY) {
    throw new Error("Gas price API key is missing. Add VITE_GAS_PRICE_API_KEY to your .env file.");
  }

  const [{ mapCenter, tomtomStations, stateCode }, gasZip] = await Promise.all([
    fetchTomTomStations(zip),
    fetchGasPricesForZip(zip)
  ]);

  const { stations, stationCount, averagePrice } = await mergeGasDataIntoTomTomStations(
    zip,
    tomtomStations,
    gasZip,
    stateCode
  );

  return {
    zip,
    averagePrice,
    stationCount,
    stations,
    mapCenter,
    stateCode
  };
}
