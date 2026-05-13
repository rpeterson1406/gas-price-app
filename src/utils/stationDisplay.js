/**
 * Shared helpers for station list + map popups.
 * Supports merged TomTom+API rows ({ name, address, price }) and raw TomTom results.
 */
export function getStationName(station) {
  if (typeof station?.name === "string" && station.name.trim()) {
    return station.name.trim();
  }
  const name = station?.poi?.name?.trim();
  return name || "Unknown station";
}

export function getStationStreetAddress(station) {
  if (typeof station?.address === "string" && station.address.trim()) {
    return station.address.trim();
  }
  const addr = station?.address;
  if (!addr || typeof addr !== "object") return "Address not available";
  if (addr.freeformAddress?.trim()) return addr.freeformAddress.trim();
  const parts = [
    [addr.streetNumber, addr.streetName].filter(Boolean).join(" ").trim(),
    addr.municipality,
    addr.extendedPostalCode || addr.postalCode,
    addr.countrySubdivision
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Address not available";
}

/** Regular price when present on merged station objects. */
export function getStationPrice(station) {
  const p = station?.price;
  if (typeof p === "number" && Number.isFinite(p)) return p;
  return null;
}
