import React, { useCallback, useState } from "react";
import { getaveragegasprice, searchStationsInMapArea } from "./agent/gasPriceAgent";
import StationMap from "./components/StationMap.jsx";
import {
  getStationName,
  getStationStreetAddress
} from "./utils/stationDisplay";

function App() {
  const [zip, setZip] = useState("");
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState(null);
  const [mapAreaBusy, setMapAreaBusy] = useState(false);

  function validateZip(value) {
    return /^\d{5}$/.test(value);
  }

  async function handleGetPrice() {
    setErrorMessage("");
    setResult(null);

    if (!validateZip(zip)) {
      setStatus("error");
      setErrorMessage("Please enter a valid 5-digit ZIP code.");
      return;
    }

    setStatus("loading");

    try {
      const data = await getaveragegasprice(zip);
      setResult(data);
      setStatus("success");
    } catch (error) {
      setStatus("error");
      const message =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "";
      setErrorMessage(message.trim() || "Something went wrong.");
    }
  }

  /**
   * Called by the map after the user pans or zooms (debounced in StationMap).
   * Re-queries TomTom for gas stations near the new map center / radius, then
   * generates deterministic demo prices for the same ZIP.
   */
  const handleMapViewportSearch = useCallback(
    async ({ lat, lng, radiusMeters }) => {
      if (status !== "success" || !validateZip(zip)) return;

      setMapAreaBusy(true);
      try {
        const partial = await searchStationsInMapArea(
          zip,
          lat,
          lng,
          radiusMeters
        );
        setResult((prev) => (prev ? { ...prev, ...partial } : prev));
      } catch (err) {
        console.warn("Map area station search failed:", err);
      } finally {
        setMapAreaBusy(false);
      }
    },
    [status, zip]
  );

  return (
    <main className="page">
      <section className="card">
        <h1>Yorky Gas Price Agent</h1>

        <p className="subtitle">
          Enter a ZIP for nearby stations (TomTom). Prices are demo estimates.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            handleGetPrice();
          }}
        >
          <label htmlFor="zip-input">ZIP code</label>

          <input
            id="zip-input"
            type="text"
            inputMode="numeric"
            maxLength={5}
            value={zip}
            onChange={(event) => setZip(event.target.value.trim())}
            placeholder="e.g. 90210"
          />

          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "Checking..." : "Find Gas Prices"}
          </button>
        </form>

        {status === "loading" && (
          <p className="info">Loading gas prices for ZIP {zip}...</p>
        )}

        {status === "error" && (
          <p className="error">{errorMessage}</p>
        )}

        {status === "success" && result && (
          <>
            {/* --- ZIP-level average regular price + how many stations we show --- */}
            <div className="result">
              <p className="pricing-banner pricing-banner--demo">
                <strong>Demo estimated prices.</strong> Live pricing unavailable for most zip codes.
                Showing demo price estimates.
              </p>
              <p>
                Average regular gas price in <strong>{result.zip}</strong> (demo estimated):
              </p>
              <p className="price">
                {typeof result.averagePrice === "number" && Number.isFinite(result.averagePrice)
                  ? `$${result.averagePrice.toFixed(2)} / gallon`
                  : "—"}
              </p>
              <p className="meta">
                Based on {result.stationCount} station
                {result.stationCount === 1 ? "" : "s"} in the current map view for ZIP {result.zip}.
              </p>
            </div>

            {/* --- Map: centered on ZIP geocode; markers use each station's TomTom coordinates --- */}
            {result.mapCenter && (
              <StationMap
                mapKey={result.zip}
                mapCenter={result.mapCenter}
                stations={result.stations}
                onViewportSearch={handleMapViewportSearch}
                mapAreaBusy={mapAreaBusy}
                pricingSource="demo"
              />
            )}

            {/* --- Text list of nearby stations from TomTom --- */}
            <div className="nearby-section">
              <h2 className="nearby-heading">
                Nearby Gas Stations
                <span className="nearby-sub"> — Demo estimated prices</span>
              </h2>
              {!result.stations || result.stations.length === 0 ? (
                <p className="stations-empty">No nearby stations found.</p>
              ) : (
                <ul className="station-list">
                  {result.stations.map((station, index) => (
                    <li
                      key={station.id ?? `station-${index}`}
                      className="station-item"
                    >
                      <div className="station-name">{getStationName(station)}</div>
                      <div className="station-address">
                        {getStationStreetAddress(station)}
                      </div>
                      {typeof station.regularPrice === "number" &&
                        Number.isFinite(station.regularPrice) && (
                        <div className="station-price">
                          Demo estimate: ${station.regularPrice.toFixed(2)} / gal
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}

      </section>
    </main>
  );
}

export default App;
