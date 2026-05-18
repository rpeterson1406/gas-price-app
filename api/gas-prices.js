/**
 * Vercel serverless: GET /api/gas-prices?zip=12345
 * Gas pricing now uses deterministic demo estimates in the frontend, so this
 * route intentionally does not call Apify.
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

  res.statusCode = 410;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      error: "Live gas pricing API is disabled. The app uses demo estimated prices."
    })
  );
}
