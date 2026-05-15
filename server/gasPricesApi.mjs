import {
  buildGasPricesApiPayload,
  datasetItemToStation,
  datasetItemsForZip
} from "../src/lib/apifyDatasetNormalize.js";

function wantsDebug(searchParams) {
  const v = (searchParams.get("debug") || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function formatErr(data, text) {
  if (data?.error?.message) return String(data.error.message);
  if (typeof data?.error === "string") return data.error;
  if (data?.message) return String(data.message);
  return String(text || "").replace(/\s+/g, " ").slice(0, 220);
}

async function fetchDatasetItemsRaw(datasetId, token, useQueryToken) {
  const t = String(token ?? "").trim();
  const base = `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items`;
  const params = new URLSearchParams({ clean: "1" });
  if (useQueryToken && t) {
    params.set("token", t);
  }
  const url = `${base}?${params}`;
  const headers = { Accept: "application/json" };
  if (!useQueryToken && t) {
    headers.Authorization = `Bearer ${t}`;
  }

  const res = await fetch(url, { headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { res, text, data };
}

/**
 * Server-only: Apify GET /v2/datasets/{datasetId}/items (token never sent to browser).
 * On 401, retries once with the other auth style (Bearer vs ?token=).
 */
export async function fetchApifyDatasetItemsServer({ datasetId, token, useQueryToken }) {
  const t = String(token ?? "").trim();
  if (!t) {
    const err = new Error("Apify token is empty after trim.");
    err.status = 500;
    throw err;
  }

  let { res, text, data } = await fetchDatasetItemsRaw(datasetId, t, useQueryToken);
  if (res.status === 401) {
    ({ res, text, data } = await fetchDatasetItemsRaw(datasetId, t, !useQueryToken));
  }

  if (!res.ok) {
    const msg =
      data != null
        ? formatErr(data, text) || res.statusText
        : String(text || res.statusText || "").replace(/\s+/g, " ").slice(0, 220);
    let hint = "";
    if (res.status === 401) {
      hint =
        " Copy your personal API token from Apify Console → Settings → Integrations (not an Actor API or other key). Restart npm run dev after editing .env.";
    }
    const err = new Error(
      res.status === 401 ? `Unauthorized: ${msg}${hint}` : `Apify ${res.status}: ${msg}`
    );
    err.status = res.status;
    throw err;
  }

  if (data && typeof data === "object" && !Array.isArray(data) && data.error) {
    throw new Error(formatErr(data, text));
  }
  if (!Array.isArray(data)) {
    throw new Error("Apify dataset items: expected a JSON array.");
  }
  return data;
}

export async function handleGasPricesApiRequest(req, { datasetId, token, useQueryToken }) {
  const url = new URL(req.url || "/", "http://localhost");
  const zip = (url.searchParams.get("zip") || "").trim();

  if (!/^\d{5}$/.test(zip)) {
    return {
      status: 400,
      body: { error: "Query ?zip= must be a 5-digit US ZIP." }
    };
  }

  if (!datasetId) {
    return {
      status: 500,
      body: {
        error:
          "VITE_APIFY_DATASET_ID is missing. Set it in .env next to vite.config.js from your Apify dataset URL."
      }
    };
  }

  if (!String(token || "").trim()) {
    return {
      status: 500,
      body: {
        error:
          "APIFY_API_TOKEN is missing on the server. Add it to .env (not VITE_) next to vite.config.js and restart npm run dev."
      }
    };
  }

  try {
    const allItems = await fetchApifyDatasetItemsServer({
      datasetId,
      token,
      useQueryToken
    });

    /** ZIP-filtered pipeline input (same as buildGasPricesApiPayload / parseGasZipFromDataset). */
    const items = datasetItemsForZip(allItems, zip);

    if (wantsDebug(url.searchParams)) {
      const normalizedStations = items.map((row) => datasetItemToStation(row));
      const validPrices = normalizedStations
        .map((s) => s.regularPrice)
        .filter((p) => typeof p === "number" && p > 0);
      return {
        status: 200,
        body: {
          zip,
          rawCount: items.length,
          rawSample: items.slice(0, 3),
          normalizedStations,
          validPrices
        }
      };
    }

    const payload = buildGasPricesApiPayload(allItems, zip);
    return { status: 200, body: payload };
  } catch (e) {
    const status = e.status && Number.isFinite(e.status) ? e.status : 502;
    return {
      status,
      body: { error: String(e?.message || e) }
    };
  }
}
