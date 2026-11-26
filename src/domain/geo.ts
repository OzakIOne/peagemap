const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;

export const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const rLat1 = lat1 * DEG_TO_RAD;
  const rLat2 = lat2 * DEG_TO_RAD;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const a = sinDLat * sinDLat + Math.cos(rLat1) * Math.cos(rLat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
};

export interface RouteProjection {
  distanceFromRouteKm: number;
  distanceAlongRouteKm: number;
  coordIndex: number;
}

export const buildCumulativeDistancesKm = (coordinates: Array<[number, number]>): number[] => {
  const cumulative: number[] = Array.from({ length: coordinates.length }, () => 0);
  for (let i = 1; i < coordinates.length; i += 1) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    if (!prev || !curr) continue;
    cumulative[i] = (cumulative[i - 1] ?? 0) + haversineKm(prev[1], prev[0], curr[1], curr[0]);
  }
  return cumulative;
};

export const projectPointToRoute = (params: {
  lat: number;
  lon: number;
  coordinates: Array<[number, number]>;
  cumulativeDistancesKm: number[];
}): RouteProjection => {
  const { lat, lon, coordinates, cumulativeDistancesKm } = params;
  if (coordinates.length === 0) {
    return {
      distanceFromRouteKm: Number.POSITIVE_INFINITY,
      distanceAlongRouteKm: 0,
      coordIndex: 0,
    };
  }

  const cosLat = Math.cos(lat * DEG_TO_RAD);
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * cosLat;

  let bestDistSq = Number.POSITIVE_INFINITY;
  let bestAlongKm = 0;
  let bestIndex = 0;

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const a = coordinates[i];
    const b = coordinates[i + 1];
    if (!a || !b) continue;

    const ax = (a[0] - lon) * kmPerDegLon;
    const ay = (a[1] - lat) * kmPerDegLat;
    const bx = (b[0] - lon) * kmPerDegLon;
    const by = (b[1] - lat) * kmPerDegLat;

    const dx = bx - ax;
    const dy = by - ay;
    const segLenSq = dx * dx + dy * dy;

    let t = 0;
    if (segLenSq > 1e-12) {
      t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / segLenSq));
    }

    const px = ax + t * dx;
    const py = ay + t * dy;
    const distSq = px * px + py * py;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      const segStartKm = cumulativeDistancesKm[i] ?? 0;
      const segEndKm = cumulativeDistancesKm[i + 1] ?? segStartKm;
      bestAlongKm = segStartKm + t * (segEndKm - segStartKm);
      bestIndex = t < 0.5 ? i : i + 1;
    }
  }

  return {
    distanceFromRouteKm: Math.sqrt(bestDistSq),
    distanceAlongRouteKm: bestAlongKm,
    coordIndex: bestIndex,
  };
};

export const sliceRouteCoordinates = (
  coordinates: Array<[number, number]>,
  startIndex: number,
  endIndex: number,
): Array<[number, number]> => {
  const clampedStart = Math.max(0, Math.min(startIndex, coordinates.length - 1));
  const clampedEnd = Math.max(clampedStart, Math.min(endIndex, coordinates.length - 1));
  if (clampedStart === clampedEnd) {
    const pt = coordinates[clampedStart];
    return pt ? [pt] : [];
  }
  return coordinates.slice(clampedStart, clampedEnd + 1);
};
