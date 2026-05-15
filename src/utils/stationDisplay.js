/**
 * Shared helpers for station list + map popups.
 * Merged TomTom + Apify rows use regularPrice (positive cash, else positive credit); raw TomTom has neither.
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
