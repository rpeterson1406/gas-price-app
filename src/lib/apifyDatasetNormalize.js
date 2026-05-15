/**
 * Shared Apify dataset → station/pricing normalization (browser + Node).
 * Used by the dev server /api/gas-prices route and the frontend merge logic.
 */

function mean(nums) {
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum / nums.length;
}

/** Regular gas from dataset: cash if positive, else credit if positive, else null. */
export function computeRegularPrice(item) {
  if (!item || typeof item !== "object") return null;
  return typeof item.price_cash === "number" && item.price_cash > 0
    ? item.price_cash
    : typeof item.price_credit === "number" && item.price_credit > 0
      ? item.price_credit
      : null;
}

export function extractZipFromItem(item) {
  if (!item || typeof item !== "object") return null;
  const v =
    item.address_postalCode ??
    item.zip ??
    item.zipCode ??
    item.postalCode ??
    item.postal_code ??
    item.ZIP ??
    item.Zip;
  if (v == null) return null;
  const digits = String(v).replace(/\D/g, "");
  return digits.length >= 5 ? digits.slice(0, 5) : null;
}

export function datasetItemsForZip(allItems, zip) {
  const list = Array.isArray(allItems) ? allItems : [];
  const z = String(zip || "").trim();
  if (!z) return list;
  const anyZip = list.some((it) => extractZipFromItem(it) != null);
  if (!anyZip) return list;
  return list.filter((it) => extractZipFromItem(it) === z);
}

export function datasetItemToStation(row) {
  if (!row || typeof row !== "object") {
    return {
      name: "",
      address: "",
      city: "",
      state: "",
      zip: "",
      regularPrice: null,
      cashPrice: null,
      creditPrice: null,
      rating: null
    };
  }

  const regularPrice = computeRegularPrice(row);

  const name = String(
    row.name ||
      row.stationName ||
      row.station ||
      row.brand ||
      row.brandName ||
      "Gas station"
  ).trim();

  return {
    name,
    address: String(row.address_line1 || "").trim(),
    city: String(row.address_locality || "").trim(),
    state: String(row.address_region || "").trim(),
    zip: String(row.address_postalCode ?? row.zip ?? "").trim(),
    regularPrice,
    cashPrice: row.price_cash ?? null,
    creditPrice: row.price_credit ?? null,
    rating: row.starRating ?? null
  };
}

export function positionFromRow(row) {
  const rawLat = row.lat ?? row.latitude ?? row?.position?.lat;
  const rawLon = row.lon ?? row.lng ?? row.longitude ?? row?.position?.lon;
  const lat = typeof rawLat === "string" ? parseFloat(rawLat) : rawLat;
  const lon = typeof rawLon === "string" ? parseFloat(rawLon) : rawLon;
  if (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon)
  ) {
    return { lat, lon };
  }
  return null;
}

/**
 * Internal shape consumed by mergeGasDataIntoTomTomStations in gasPriceAgent.
 * Only includes stations with a usable regularPrice (cash/credit rule).
 */
export function parseGasZipFromDataset(items, zip) {
  const rowsRaw = datasetItemsForZip(items, zip);
  const rows = rowsRaw
    .map(datasetItemToStation)
    .filter((r) => r.name.length > 0 && r.regularPrice != null);

  const pricedValues = rows.map((r) => r.regularPrice);
  const zipAverageField = pricedValues.length ? mean(pricedValues) : null;

  return { rows, pricedRows: rows, zipAverageField, raw: { items: rowsRaw } };
}

/**
 * Public JSON returned by GET /api/gas-prices for the frontend.
 * Omits stations with no regularPrice.
 */
export function buildGasPricesApiPayload(items, zip) {
  const rowsRaw = datasetItemsForZip(items, zip);
  const stations = rowsRaw
    .map((row, i) => {
      const s = datasetItemToStation(row);
      if (s.regularPrice == null || !s.name.length) return null;
      return {
        id: String(row.id ?? `row-${i}`),
        name: s.name,
        address: s.address,
        city: s.city,
        state: s.state,
        zip: s.zip,
        regularPrice: s.regularPrice,
        cashPrice: s.cashPrice,
        creditPrice: s.creditPrice,
        rating: s.rating,
        position: positionFromRow(row)
      };
    })
    .filter(Boolean);

  const pricedValues = stations.map((st) => st.regularPrice);
  const averageRegular = pricedValues.length ? mean(pricedValues) : null;

  return {
    zip: String(zip || "").trim(),
    averageRegular,
    pricedStationCount: stations.length,
    stationCount: stations.length,
    stations,
    rawDatasetItems: rowsRaw
  };
}

export { mean };
