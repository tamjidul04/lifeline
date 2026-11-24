export type Point = { lat: number; lng: number };

/** Great-circle distance in km (haversine). */
export function distanceKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated courier time: 30 min handling + travel at an average 40 km/h in city traffic. */
export const HANDLING_MINUTES = 30;
export const COURIER_KMH = 40;
export const transitMinutes = (km: number) => HANDLING_MINUTES + (km / COURIER_KMH) * 60;
