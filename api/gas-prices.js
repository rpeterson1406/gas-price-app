import {
  getGasPricesHandlerOptionsFromEnv,
  handleGasPricesApiRequest
} from "../server/gasPricesApi.mjs";

/**
 * Vercel serverless: GET /api/gas-prices?zip=12345
 * Default export is the Node request handler (req, res).
 */
export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const url = req.url || "/";
  const result = await handleGasPricesApiRequest(
    { url },
    getGasPricesHandlerOptionsFromEnv()
  );

  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.body));
}
