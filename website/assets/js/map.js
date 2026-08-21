/* ==========================================================================
   map.js - city map of the bin fleet
   --------------------------------------------------------------------------
   Uses Leaflet + OpenStreetMap tiles when the page has internet access.
   When Leaflet is missing (no internet, or the file is opened offline from a
   USB stick during a viva) it silently falls back to a lightweight grid map
   drawn with plain HTML, so clicking and selecting bins still works.

   Public API
     const map = new BinMap("map", { onSelect: fn, interactive: true });
     map.setBins(arrayOfBins);
     map.select("BIN-004");
   ========================================================================== */

function BinMap(containerId, options) {
  options = options || {};

  const container   = document.getElementById(containerId);
  const onSelect    = options.onSelect || function () {};
  const interactive = options.interactive !== false;

  const CITY_CENTER = [17.4200, 78.4600];   /* Hyderabad */
  const DEFAULT_ZOOM = 11;

  let leafletMap = null;
  let markers    = {};
  let bins       = [];
  let selectedId = null;
  const useLeaflet = (typeof L !== "undefined" && L && L.map);

  /* ------------------------------------------------------------------ */
  /*  Leaflet mode                                                       */
  /* ------------------------------------------------------------------ */
  if (useLeaflet) {
    leafletMap = L.map(containerId, {
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      attributionControl: true
    }).setView(CITY_CENTER, DEFAULT_ZOOM);

    /* A very light, low-contrast basemap so the coloured bin pins carry
       all of the visual weight - the same idea as Apple Maps in light mode. */
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO"
    }).addTo(leafletMap);
  } else {
    container.classList.add("has-fallback");
  }

  /* ------------------------------------------------------------------ */
  /*  Marker helpers                                                     */
  /* ------------------------------------------------------------------ */
  function markerHtml(bin, status) {
    const shortId = bin.id.replace("BIN-", "");
    const sel = bin.id === selectedId ? " selected" : "";
    return '<div class="bin-marker m-' + status + sel + '"><span>' + shortId + '</span></div>';
  }

  function popupHtml(bin, status) {
    return '<b>' + escapeHtml(bin.name) + '</b><br>' +
           '<span class="muted">' + escapeHtml(bin.id) + ' &middot; ' +
           escapeHtml(bin.zone) + '</span><br>' +
           'Fill: <b>' + Math.round(bin.fill) + '%</b> &middot; ' +
           'Lid: <b>' + bin.lid + '</b><br>' +
           'Status: <b>' + SD.statusLabel(status) + '</b>';
  }

  /* ------------------------------------------------------------------ */
  /*  Fallback mode - simple equirectangular projection onto a grid      */
  /* ------------------------------------------------------------------ */
  function renderFallback() {
    const lats = bins.map(b => b.lat), lngs = bins.map(b => b.lng);
    const pad  = 0.02;
    const minLat = Math.min.apply(null, lats) - pad;
    const maxLat = Math.max.apply(null, lats) + pad;
    const minLng = Math.min.apply(null, lngs) - pad;
    const maxLng = Math.max.apply(null, lngs) + pad;

    let html = '<div class="fallback-map">';
    bins.forEach(bin => {
      const status = SD.statusOf(bin);
      const x = ((bin.lng - minLng) / (maxLng - minLng)) * 100;
      const y = (1 - (bin.lat - minLat) / (maxLat - minLat)) * 100;
      html += '<div class="fm-pin" data-bin="' + bin.id + '" ' +
              'style="left:' + x.toFixed(2) + '%;top:' + y.toFixed(2) + '%" ' +
              'title="' + escapeHtml(bin.name) + ' - ' + Math.round(bin.fill) + '%">' +
              markerHtml(bin, status) + '</div>';
    });
    html += '<div class="fm-note">Offline map view &middot; ' +
            'connect to the internet for street tiles</div></div>';
    container.innerHTML = html;

    if (interactive) {
      container.querySelectorAll(".fm-pin").forEach(pin => {
        pin.addEventListener("click", () => {
          select(pin.getAttribute("data-bin"));
          onSelect(pin.getAttribute("data-bin"));
        });
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Public methods                                                     */
  /* ------------------------------------------------------------------ */
  function setBins(newBins) {
    bins = newBins;

    if (!useLeaflet) { renderFallback(); return; }

    bins.forEach(bin => {
      const status = SD.statusOf(bin);
      const icon = L.divIcon({
        className: "",
        html: markerHtml(bin, status),
        iconSize: [30, 30],
        iconAnchor: [15, 28],
        popupAnchor: [0, -26]
      });

      if (markers[bin.id]) {
        markers[bin.id].setIcon(icon);
        markers[bin.id].setPopupContent(popupHtml(bin, status));
      } else {
        const m = L.marker([bin.lat, bin.lng], { icon: icon }).addTo(leafletMap);
        m.bindPopup(popupHtml(bin, status));
        if (interactive) {
          m.on("click", () => { select(bin.id); onSelect(bin.id); });
        }
        markers[bin.id] = m;
      }
    });
  }

  function select(binId) {
    selectedId = binId;
    setBins(bins);                       /* re-render icons with the outline */
    if (useLeaflet && markers[binId]) {
      markers[binId].openPopup();
    }
  }

  function flyTo(binId) {
    const bin = bins.find(b => b.id === binId);
    if (!bin) return;
    if (useLeaflet) leafletMap.flyTo([bin.lat, bin.lng], 15, { duration: .7 });
  }

  function fitAll() {
    if (!useLeaflet || !bins.length) return;
    leafletMap.fitBounds(bins.map(b => [b.lat, b.lng]), { padding: [40, 40] });
  }

  return {
    setBins: setBins,
    select: select,
    flyTo: flyTo,
    fitAll: fitAll,
    isFallback: !useLeaflet
  };
}
