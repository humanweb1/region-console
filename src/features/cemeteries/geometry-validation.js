function pointInRing(point, ring) {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]; const b = ring[j];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue;
    const xi = Number(a[0]); const yi = Number(a[1]);
    const xj = Number(b[0]); const yj = Number(b[1]);
    const intersects = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInGeometry(lng, lat, geometry) {
  if (!geometry || !Number.isFinite(Number(lng)) || !Number.isFinite(Number(lat))) return false;
  const point = [Number(lng), Number(lat)];
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates || [];
    if (!pointInRing(point, rings[0])) return false;
    return !rings.slice(1).some((hole) => pointInRing(point, hole));
  }
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).some((polygon) => pointInGeometry(lng, lat, { type: "Polygon", coordinates: polygon }));
  return false;
}

export function geometryVerticesInside(childGeometry, parentGeometry) {
  if (!childGeometry || !parentGeometry) return false;
  const polygons = childGeometry.type === "Polygon" ? [childGeometry.coordinates || []] : childGeometry.type === "MultiPolygon" ? childGeometry.coordinates || [] : [];
  const vertices = polygons.flatMap((rings) => (rings[0] || []).map(([lng, lat]) => [Number(lng), Number(lat)]));
  return vertices.length >= 3 && vertices.every(([lng, lat]) => pointInGeometry(lng, lat, parentGeometry));
}
