/* ==========================================================================
   route.js - plans the collection truck's route
   --------------------------------------------------------------------------
   WHAT PROBLEM THIS SOLVES
   The crew has N full bins scattered across the city and one truck. Visiting
   them in the "wrong" order can easily double the distance driven. Finding
   the truly shortest order is the Travelling Salesman Problem, which has no
   fast exact solution - 20 bins already have 20! (about 2.4 x 10^18) orders.
   So we do what real fleet software does: a fast heuristic that is usually
   within a few percent of the best answer.

     1. NEAREST NEIGHBOUR - from the start, always drive to the closest bin
        not yet visited. Quick, but it paints itself into corners and leaves
        long jumps at the end, which show up as crossing lines on the map.
     2. 2-OPT - look at every pair of legs A->B ... C->D. If swapping them to
        A->C ... B->D (i.e. reversing the stretch B..C) is shorter, do it.
        Repeat until no swap helps. A route that crosses itself can ALWAYS
        be shortened this way, so 2-opt removes every crossing.

   Distances are straight lines on the globe (the haversine formula). Roads
   are longer than straight lines, so estimate() scales by 1.35 - a common
   "detour factor" for city grids. Google Maps then plans the actual roads:
   legs() turns the ordered stops into Google Maps links, split into chunks
   because a Maps link only accepts a few waypoints.

   PURE: no DOM, no clock, no randomness - the same input always gives the
   same route, which is what lets tests/route.test.js check it under Node.

   Public API
     RoutePlanner.haversineKm(a, b)                       -> km
     RoutePlanner.plan(stops, { start, returnToStart })   -> { order, km }
     RoutePlanner.estimate(plan, stops?, opts?)           -> { roadKm, minutes, litres }
     RoutePlanner.legs(start, order, { returnToStart, maxWaypoints, includeOrigin })
                                                          -> [{ index, stops, points, origin,
                                                                destination, returnsToStart, url }]
     RoutePlanner.mapsUrl(origin|null, destination, waypoints, { navigate }) -> string
   Also exported for tests and teaching:
     RoutePlanner.nearestNeighbour(start, stops) -> [stops]
     RoutePlanner.twoOpt(start, order, { returnToStart }) -> { order, km }
     RoutePlanner.pathKm(start, order, returnToStart) -> km
   A "point" is anything with numeric lat and lng - a bin record works as is.
   ========================================================================== */

const RoutePlanner = (function () {

  const EARTH_RADIUS_KM = 6371.0088;   /* mean Earth radius (IUGG) */
  const ROAD_FACTOR     = 1.35;        /* straight line -> city roads */
  const SPEED_KMH       = 22;          /* a garbage truck in city traffic */
  const MINUTES_PER_STOP = 4;          /* park, open, tip, close */
  const MAX_2OPT_PASSES = 200;         /* safety cap; real inputs settle in < 10 */
  const EPS             = 1e-10;       /* ignore "improvements" from rounding */

  /* Google Maps URLs: "up to nine waypoints" on desktop / the app, three in
     a mobile browser. More than nine is rejected, so clamp to that. */
  const GMAPS_MAX_WAYPOINTS = 9;
  const GMAPS_BASE = "https://www.google.com/maps/dir/?api=1";
  const GMAPS_URL_LIMIT = 2048;

  /* ---- geometry -------------------------------------------------------- */
  function toRad(deg) { return deg * Math.PI / 180; }

  function checkPoint(p) {
    if (!p || !isFinite(p.lat) || !isFinite(p.lng)) {
      throw new TypeError("RoutePlanner: a point needs numeric lat and lng");
    }
    return p;
  }

  /* Great-circle distance. The haversine form stays accurate for the short
     distances inside one city, where the simpler cosine formula loses
     precision to rounding. */
  function haversineKm(a, b) {
    checkPoint(a); checkPoint(b);
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Length of start -> order[0] -> ... -> order[n-1] (-> start). */
  function pathKm(start, order, returnToStart) {
    let km = 0;
    let prev = start;
    order.forEach(function (p) {
      if (prev) km += haversineKm(prev, p);
      prev = p;
    });
    if (returnToStart && start && order.length) km += haversineKm(prev, start);
    return km;
  }

  /* Distance matrix over [start, ...stops], so the inner loops below are
     array lookups instead of trigonometry. Index 0 is the start. */
  function matrix(nodes) {
    const n = nodes.length;
    const d = [];
    for (let i = 0; i < n; i++) {
      d.push(new Array(n).fill(0));
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        d[i][j] = d[j][i] = haversineKm(nodes[i], nodes[j]);
      }
    }
    return d;
  }

  /* ---- step 1: nearest neighbour (on indices) --------------------------
     Returns a tour of node indices starting with 0. Ties go to the lower
     index, which keeps the result deterministic. */
  function nnTour(d) {
    const n = d.length;
    const seen = new Array(n).fill(false);
    const tour = [0];
    seen[0] = true;
    let cur = 0;
    for (let k = 1; k < n; k++) {
      let best = -1, bestD = Infinity;
      for (let j = 1; j < n; j++) {
        if (!seen[j] && d[cur][j] < bestD) { bestD = d[cur][j]; best = j; }
      }
      seen[best] = true;
      tour.push(best);
      cur = best;
    }
    return tour;
  }

  /* ---- step 2: 2-opt (on indices) --------------------------------------
     tour[0] is the start and never moves. For positions i < j, reversing
     tour[i..j] replaces the edges (tour[i-1], tour[i]) and (tour[j], next)
     with (tour[i-1], tour[j]) and (tour[i], next). On an OPEN path the last
     stop has no "next", so only the first edge changes. On a CLOSED tour the
     "next" after the last stop is the start again. */
  function twoOptTour(tour, d, closed) {
    const n = tour.length - 1;          /* number of movable stops */
    let improved = true;
    let passes = 0;
    while (improved && passes < MAX_2OPT_PASSES) {
      improved = false;
      passes++;
      for (let i = 1; i < n; i++) {
        for (let j = i + 1; j <= n; j++) {
          const a = tour[i - 1], b = tour[i], c = tour[j];
          const next = j < n ? tour[j + 1] : (closed ? tour[0] : -1);
          const before = d[a][b] + (next >= 0 ? d[c][next] : 0);
          const after  = d[a][c] + (next >= 0 ? d[b][next] : 0);
          if (after < before - EPS) {
            /* reverse tour[i..j] in place */
            for (let lo = i, hi = j; lo < hi; lo++, hi--) {
              const t = tour[lo]; tour[lo] = tour[hi]; tour[hi] = t;
            }
            improved = true;
          }
        }
      }
    }
    return tour;
  }

  /* ---- public wrappers over real points -------------------------------- */
  function nearestNeighbour(start, stops) {
    checkPoint(start);
    const nodes = [start].concat(stops);
    return nnTour(matrix(nodes)).slice(1).map(function (i) { return nodes[i]; });
  }

  function twoOpt(start, order, opts) {
    checkPoint(start);
    const closed = !!(opts && opts.returnToStart);
    const nodes = [start].concat(order);
    const tour = nodes.map(function (_, i) { return i; });
    twoOptTour(tour, matrix(nodes), closed);
    const out = tour.slice(1).map(function (i) { return nodes[i]; });
    return { order: out, km: pathKm(start, out, closed) };
  }

  /* plan(stops, { start, returnToStart })
     With a start point: the truck leaves from it (depot, or the crew's
     location); the start is not part of `order`.
     Without one (start null): the FIRST stop in `stops` is where the crew
     begins - it stays first in `order` - and the rest are routed from it.
     The caller decides which bin that is (collector.js passes the fullest). */
  function plan(stops, opts) {
    opts = opts || {};
    const list = (stops || []).slice();          /* never mutate the caller's array */
    const closed = !!opts.returnToStart;
    list.forEach(checkPoint);

    let start = opts.start || null;
    let head = [];
    if (!start) {
      if (!list.length) return { order: [], km: 0 };
      start = list.shift();
      head = [start];
    } else {
      checkPoint(start);
    }
    if (!list.length) return { order: head, km: 0 };   /* 0 or 1 stop: nothing to optimise */

    const nodes = [start].concat(list);
    const d = matrix(nodes);
    const tour = twoOptTour(nnTour(d), d, closed);
    const routed = tour.slice(1).map(function (i) { return nodes[i]; });
    return {
      order: head.concat(routed),
      km: pathKm(start, routed, closed)
    };
  }

  /* estimate(plan, stops?, opts?)
     roadKm  = straight-line km x 1.35
     minutes = driving at 22 km/h + 4 minutes per stop
     litres  = what the truck will carry: sum(capacity x fill / 100)
     `stops` defaults to plan.order (pass the bin records if the plan holds
     something else). Rounded for display: 0.1 km, whole minutes and litres. */
  function estimate(p, stops, opts) {
    opts = opts || {};
    const list = stops || (p && p.order) || [];
    const factor = opts.roadFactor || ROAD_FACTOR;
    const speed  = opts.speedKmh || SPEED_KMH;
    const perStop = opts.minutesPerStop != null ? opts.minutesPerStop : MINUTES_PER_STOP;

    const roadKm = ((p && p.km) || 0) * factor;
    const minutes = (roadKm / speed) * 60 + perStop * list.length;
    const litres = list.reduce(function (sum, s) {
      const cap  = Number(s.capacity) || 0;
      const fill = Math.max(0, Math.min(100, Number(s.fill) || 0));
      return sum + cap * fill / 100;
    }, 0);

    return {
      roadKm:  Math.round(roadKm * 10) / 10,
      minutes: Math.round(minutes),
      litres:  Math.round(litres)
    };
  }

  /* ---- Google Maps links ----------------------------------------------
     Format per Google's "Maps URLs" documentation:
       https://www.google.com/maps/dir/?api=1&origin=..&destination=..
             &waypoints=a%7Cb&travelmode=driving&dir_action=navigate
     Coordinates are "lat,lng" with the comma encoded as %2C, waypoints are
     separated by "|" encoded as %7C. No API key is needed. */
  function fmtPoint(p) {
    checkPoint(p);
    return Number(p.lat).toFixed(6) + "%2C" + Number(p.lng).toFixed(6);
  }

  /* navigate: add dir_action=navigate so the phone starts turn-by-turn at
     once. Google only honours it when the trip starts at the phone, so it is
     added only when there is no origin (default: on in that case). */
  function mapsUrl(origin, destination, waypoints, opts) {
    opts = opts || {};
    const wps = waypoints || [];
    let url = GMAPS_BASE;
    if (origin) url += "&origin=" + fmtPoint(origin);
    url += "&destination=" + fmtPoint(destination);
    if (wps.length) url += "&waypoints=" + wps.map(fmtPoint).join("%7C");
    url += "&travelmode=driving";
    if (!origin && opts.navigate !== false) url += "&dir_action=navigate";
    if (url.length > GMAPS_URL_LIMIT) {
      /* Cannot happen with <= 9 waypoints (about 250 characters), but a
         silently truncated link would send the truck to the wrong place. */
      throw new RangeError("RoutePlanner: Maps URL longer than " + GMAPS_URL_LIMIT + " characters");
    }
    return url;
  }

  /* legs(start, order, { returnToStart, maxWaypoints = 9, includeOrigin = false })
     Splits the visiting order into Google Maps links. Each leg holds up to
     maxWaypoints waypoints + 1 destination, so up to maxWaypoints+1 points.
     If returnToStart, the start point is appended as the final destination
     (start null = the route began at order[0], so that is where it returns).
       includeOrigin = false  no origin: Google starts from wherever the phone
                              is, and dir_action=navigate is added. Best for
                              the crew - after leg 1 the phone IS at the
                              previous leg's last stop.
       includeOrigin = true   leg 1 starts at `start` (when given), leg N at
                              leg N-1's destination. Best for planning on a PC.
     Each leg: { index (1-based), stops: bins only, points: everything visited
     including a return-to-start, origin, destination, returnsToStart, url }. */
  function legs(start, order, opts) {
    opts = opts || {};
    const list = order || [];
    if (!list.length) return [];

    let maxW = opts.maxWaypoints == null ? GMAPS_MAX_WAYPOINTS : Math.floor(opts.maxWaypoints);
    if (!(maxW >= 0)) maxW = GMAPS_MAX_WAYPOINTS;
    maxW = Math.min(GMAPS_MAX_WAYPOINTS, maxW);
    const perLeg = maxW + 1;
    const includeOrigin = !!opts.includeOrigin;

    const home = start || list[0];
    const RETURN = { lat: home.lat, lng: home.lng, isReturn: true, name: home.name || "Start" };
    const points = list.slice();
    if (opts.returnToStart) points.push(RETURN);

    const out = [];
    let prevEnd = includeOrigin ? (start || null) : null;
    for (let i = 0; i < points.length; i += perLeg) {
      const chunk = points.slice(i, i + perLeg);
      const destination = chunk[chunk.length - 1];
      const waypoints = chunk.slice(0, -1);
      const origin = includeOrigin ? prevEnd : null;
      out.push({
        index: out.length + 1,
        stops: chunk.filter(function (p) { return p !== RETURN; }),
        points: chunk,
        origin: origin,
        destination: destination,
        returnsToStart: destination === RETURN,
        url: mapsUrl(origin, destination, waypoints, { navigate: !origin })
      });
      prevEnd = destination;
    }
    return out;
  }

  return {
    haversineKm: haversineKm,
    pathKm: pathKm,
    nearestNeighbour: nearestNeighbour,
    twoOpt: twoOpt,
    plan: plan,
    estimate: estimate,
    legs: legs,
    mapsUrl: mapsUrl,
    ROAD_FACTOR: ROAD_FACTOR,
    SPEED_KMH: SPEED_KMH,
    MINUTES_PER_STOP: MINUTES_PER_STOP,
    MAX_WAYPOINTS: GMAPS_MAX_WAYPOINTS
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { RoutePlanner };
