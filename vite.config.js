import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import {
  getGasPricesHandlerOptionsFromEnv,
  handleGasPricesApiRequest
} from "./server/gasPricesApi.mjs";

function apifyStartupLog(datasetPresent, apiToken, authMode) {
  const tokenLen = apiToken.length;
  const apiTokenPresent = tokenLen > 0;
  console.info("\n---------- Apify (server route) ----------");
  if (!datasetPresent) {
    console.warn("[vite] VITE_APIFY_DATASET_ID is missing in .env.");
  } else {
    console.info("[vite] VITE_APIFY_DATASET_ID loaded for GET /api/gas-prices?zip=.");
  }
  if (!apiTokenPresent) {
    console.warn(
      "[vite] APIFY_API_TOKEN is missing. Gas prices route will return 500 until it is set (server-only, not VITE_)."
    );
  } else {
    if (!apiToken.startsWith("apify_api_")) {
      console.warn(
        '[vite] APIFY_API_TOKEN usually starts with "apify_api_". If Apify returns 401, paste a fresh token from Apify Console → Settings → Integrations (personal API token).'
      );
    }
    if (authMode === "query") {
      console.info(
        `[vite] APIFY_API_TOKEN loaded (length=${tokenLen}). Server calls Apify with ?token=….`
      );
    } else {
      console.info(
        `[vite] APIFY_API_TOKEN loaded (length=${tokenLen}). Server calls Apify with Authorization: Bearer ….`
      );
    }
  }
  console.info("[vite] Frontend must not receive APIFY_API_TOKEN; only /api/gas-prices JSON does.");
  console.info("-----------------------------------------\n");
}

export default defineConfig(({ mode }) => {
  const envDir = path.dirname(fileURLToPath(import.meta.url));
  const env = loadEnv(mode, envDir, "");
  const mergedEnv = { ...process.env, ...env };
  const { datasetId, token, useQueryToken } = getGasPricesHandlerOptionsFromEnv(mergedEnv);

  function gasPricesApiMiddleware(req, res, next) {
    const pathname = req.url ? new URL(req.url, "http://x").pathname : "";
    if (pathname !== "/api/gas-prices") {
      next();
      return;
    }
    handleGasPricesApiRequest(req, {
      datasetId,
      token,
      useQueryToken
    })
      .then((result) => {
        res.statusCode = result.status;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(result.body));
      })
      .catch((e) => {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ error: String(e?.message || e) }));
      });
  }

  return {
    plugins: [
      react(),
      {
        name: "gas-prices-api",
        configureServer(server) {
          apifyStartupLog(
            Boolean(datasetId),
            token,
            useQueryToken ? "query" : "bearer"
          );
          server.middlewares.use(gasPricesApiMiddleware);
        },
        configurePreviewServer(server) {
          apifyStartupLog(
            Boolean(datasetId),
            token,
            useQueryToken ? "query" : "bearer"
          );
          server.middlewares.use(gasPricesApiMiddleware);
        }
      }
    ]
  };
});
