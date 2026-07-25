// Self-contained Leaflet page for the map WebView, adapted directly from
// blendit-app-design.html's own map scripts (screens 08/09) — same CARTO
// tile source, same navy pin styling, no API key required.
export function buildMapHtml(points: Array<{ id: string; lat: number; lng: number }>) {
  const pointsJson = JSON.stringify(points);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  html, body, #map { height: 100%; margin: 0; padding: 0; background: #F2F4F6; }
  .pin-d { width: 24px; height: 24px; border-radius: 50%; background: #12385F; border: 4px solid #fff; box-shadow: 0 2px 8px -2px rgba(18,56,95,.45); }
  .pin-d.active { width: 32px; height: 32px; background: #3B6FE0; }
  .leaflet-control-attribution { font-size: 8px !important; background: rgba(255,255,255,.72) !important; padding: 1px 5px !important; color: #93A0AD !important; }
</style>
</head>
<body>
<div id="map"></div>
<script>
(function () {
  var TILE = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      ATTR = '&copy; OpenStreetMap &copy; CARTO';
  var points = ${pointsJson};

  var map = L.map('map', { zoomControl: false, attributionControl: true });
  L.tileLayer(TILE, { attribution: ATTR, maxZoom: 19 }).addTo(map);

  function icon(active) {
    var size = active ? 32 : 24;
    return L.divIcon({
      html: '<div class="pin-d' + (active ? ' active' : '') + '"></div>',
      className: '',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  var markers = {};
  points.forEach(function (p) {
    var m = L.marker([p.lat, p.lng], { icon: icon(false) }).addTo(map);
    m.on('click', function () {
      window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify({ tripId: p.id }));
    });
    markers[p.id] = m;
  });

  function fitAll() {
    if (points.length > 0) {
      map.fitBounds(L.latLngBounds(points.map(function (p) { return [p.lat, p.lng]; })), { padding: [60, 60] });
    } else {
      map.setView([20, 0], 2);
    }
  }
  fitAll();

  var activeId = null;
  window.selectTrip = function (id) {
    if (activeId !== null && markers[activeId]) markers[activeId].setIcon(icon(false));
    activeId = id;
    if (id === null) {
      fitAll();
    } else if (markers[id]) {
      markers[id].setIcon(icon(true));
      map.setView(markers[id].getLatLng(), 11);
    }
  };

  setTimeout(function () { map.invalidateSize(); }, 60);
})();
</script>
</body>
</html>`;
}
