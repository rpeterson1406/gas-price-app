import L from "leaflet";
import { useCallback, useEffect, useRef } from "react";
import {
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  useMap,
  useMapEvents
} from "react-leaflet";
import {
  getStationName,
  getStationStreetAddress
} from "../utils/stationDisplay";

// Vite bundles assets differently than Leaflet expects; this restores default marker images.
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow
});

/**
 * Optional: set VITE_MAP_TILE_URL in .env to use another tile provider (some require a key in the URL).
 * Default uses free OpenStreetMap tiles (no API key).
 */
const TILE_URL =
  import.meta.env.VITE_MAP_TILE_URL ||
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const TILE_ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

/**
 * Reads lat/lon from a TomTom Search API result (each POI has a `position` object).
 */
function getStationPosition(station) {
  const lat = station?.position?.lat;
  const lon = station?.position?.lon;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return [lat, lon];
}

/**
 * Listens for pan/zoom end, then (debounced) asks the parent to search stations for the visible area.
 * `mapKey` changes when the user searches a new ZIP — we briefly ignore events so the map can settle.
 */
function MapViewportListener({ mapKey, onViewportSearch, debounceMs = 900, paused }) {
  const map = useMap();
  const readyRef = useRef(false);
  const timerRef = useRef(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    readyRef.current = false;
    const settleTimer = setTimeout(() => {
      readyRef.current = true;
    }, 800);
    return () => clearTimeout(settleTimer);
  }, [mapKey]);

  const scheduleSearch = useCallback(() => {
    if (!onViewportSearch || !readyRef.current || pausedRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (pausedRef.current) return;
      const b = map.getBounds();
      const c = b.getCenter();
      const ne = b.getNorthEast();
      const radiusMeters = Math.min(Math.max(map.distance(c, ne), 1500), 40000);
      onViewportSearch({
        lat: c.lat,
        lng: c.lng,
        radiusMeters
      });
    }, debounceMs);
  }, [map, onViewportSearch, debounceMs]);

  useMapEvents({
    moveend: scheduleSearch,
    zoomend: scheduleSearch
  });

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return null;
}

/**
 * Interactive map: centered on the ZIP geocode point, one marker per gas station.
 * Beginner note: `react-leaflet` wraps the Leaflet JS library in React components.
 */
export default function StationMap({
  mapCenter,
  stations,
  mapKey,
  onViewportSearch,
  mapAreaBusy,
  pricingSource = "live"
}) {
  const center = [mapCenter.lat, mapCenter.lon];
  const validStations = (stations || []).filter((s) => getStationPosition(s) !== null);

  return (
    <div className="map-section">
      <h2 className="nearby-heading">Station map</h2>
      <p className="map-pricing-label">
        {pricingSource === "live" ? "Live prices" : "Demo estimated prices"}
      </p>
      <p className="map-hint">
        Pan or zoom the map — station locations update for the area you view (TomTom). ZIP-level
        prices stay tied to your search ZIP (Apify dataset items from your actor run).
      </p>
      {mapAreaBusy && (
        <p className="map-busy" role="status">
          Updating stations for this map area…
        </p>
      )}
      {/*
        `key` forces React to create a fresh map when the user searches a new ZIP.
        That avoids Leaflet glitches when reusing the same container.
      */}
      <div className="map-container-wrap">
        <MapContainer
          key={mapKey}
          center={center}
          zoom={13}
          scrollWheelZoom
          className="station-leaflet-map"
        >
          <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />

          {onViewportSearch && (
            <MapViewportListener
              mapKey={mapKey}
              onViewportSearch={onViewportSearch}
              debounceMs={900}
              paused={Boolean(mapAreaBusy)}
            />
          )}

          {validStations.map((station, index) => {
            const position = getStationPosition(station);
            return (
              <Marker
                key={station.id ?? `map-station-${index}`}
                position={position}
              >
                <Popup>
                  <strong>{getStationName(station)}</strong>
                  <br />
                  {getStationStreetAddress(station)}
                  {typeof station.regularPrice === "number" &&
                    Number.isFinite(station.regularPrice) && (
                    <>
                      <br />
                      {`${pricingSource === "live" ? "Live" : "Demo estimate"}: $${station.regularPrice.toFixed(2)}/gal`}
                    </>
                  )}
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
