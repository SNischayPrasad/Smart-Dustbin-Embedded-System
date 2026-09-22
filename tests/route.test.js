/* Node test for the collection route planner - run with:  node tests/route.test.js
   route.js is pure (no DOM, no clock, no randomness), so every number the
   crew sees on collector.html can be checked here: the distance maths, that
   2-opt only ever improves a route, and that the Google Maps links are in
   exactly the format Google documents. */
const fs = require("fs");
const path = require("path");
eval(fs.readFileSync(path.join(__dirname, "../website/assets/js/route.js"), "utf8")
       .replace("const RoutePlanner", "var RoutePlanner"));

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log((ok ? "  PASS  " : "  FAIL  ") + name +
              (ok ? "" : "   expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual)));
  ok ? pass++ : fail++;
}

const R = RoutePlanner;

/* A tiny deterministic random generator (LCG), so the "random" test
   cities are the same on every run. */
function lcg(seed) {
  let s = seed >>> 0;
  return function () { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function randomStops(n, seed) {
  const rnd = lcg(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: "S" + i, lat: 17.30 + rnd() * 0.30, lng: 78.30 + rnd() * 0.30,
               capacity: 120, fill: Math.round(rnd() * 100) });
  }
  return out;
}
const DEPOT = { lat: 17.4078, lng: 78.4755, name: "Depot" };
const ids = list => list.map(p => p.id);

/* ---------- 1. haversine ---------- */
console.log("\nHaversine distance");
const CHARMINAR = { lat: 17.3616, lng: 78.4747 };
const SECUNDERABAD = { lat: 17.4340, lng: 78.5013 };
const dCS = R.haversineKm(CHARMINAR, SECUNDERABAD);
check("Charminar -> Secunderabad Station is 8-9 km (got " + dCS.toFixed(2) + ")", dCS > 8 && dCS < 9, true);
check("distance is symmetric", Math.abs(dCS - R.haversineKm(SECUNDERABAD, CHARMINAR)) < 1e-12, true);
check("a point to itself is 0 km", R.haversineKm(CHARMINAR, CHARMINAR), 0);
check("one degree of latitude is about 111.2 km",
      Math.abs(R.haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111.2) < 0.1, true);
let threw = false;
try { R.haversineKm({ lat: "x", lng: 1 }, CHARMINAR); } catch (e) { threw = true; }
check("a point without numeric lat/lng is rejected", threw, true);

/* ---------- 2. edge cases ---------- */
console.log("\nplan() edge cases");
check("0 stops -> empty route, 0 km", R.plan([], { start: DEPOT }), { order: [], km: 0 });
check("0 stops, no start -> empty route", R.plan([], {}), { order: [], km: 0 });
const one = { id: "A", lat: 17.42, lng: 78.47 };
const p1 = R.plan([one], { start: DEPOT });
check("1 stop -> that stop", ids(p1.order), ["A"]);
check("1 stop km = depot to stop", Math.abs(p1.km - R.haversineKm(DEPOT, one)) < 1e-9, true);
const p1r = R.plan([one], { start: DEPOT, returnToStart: true });
check("1 stop, return -> there and back", Math.abs(p1r.km - 2 * R.haversineKm(DEPOT, one)) < 1e-9, true);
check("1 stop, no start -> the stop, 0 km", R.plan([one], {}), { order: [one], km: 0 });

/* ---------- 3. plan() properties ---------- */
console.log("\nplan() properties");
const twenty = randomStops(20, 42);
const frozen = JSON.stringify(twenty);
const pa = R.plan(twenty, { start: DEPOT });
check("every stop visited exactly once", ids(pa.order).slice().sort(), ids(twenty).slice().sort());
check("the input array is not modified", JSON.stringify(twenty), frozen);
check("deterministic: same input, same order", ids(R.plan(twenty, { start: DEPOT }).order), ids(pa.order));
check("km matches the path length", Math.abs(pa.km - R.pathKm(DEPOT, pa.order, false)) < 1e-9, true);
const pb = R.plan(twenty, { start: null });
check("no start: the first stop stays first", pb.order[0].id, twenty[0].id);
check("no start: still visits all 20", pb.order.length, 20);

/* ---------- 4. 2-opt never worse than nearest neighbour ---------- */
console.log("\n2-opt only ever improves nearest neighbour");
let neverWorse = true, strictlyBetterSomewhere = false;
[5, 8, 12, 20, 35].forEach(function (n, k) {
  [false, true].forEach(function (closed) {
    const stops = randomStops(n, 1000 + k);
    const nn = R.nearestNeighbour(DEPOT, stops);
    const nnKm = R.pathKm(DEPOT, nn, closed);
    const planned = R.plan(stops, { start: DEPOT, returnToStart: closed });
    if (planned.km > nnKm + 1e-9) neverWorse = false;
    if (planned.km < nnKm - 1e-6) strictlyBetterSomewhere = true;
  });
});
check("plan km <= nearest-neighbour km on 10 random cities", neverWorse, true);
check("and strictly shorter on at least one of them", strictlyBetterSomewhere, true);

/* ---------- 5. a crossing square is uncrossed ---------- */
console.log("\n2-opt removes a crossing");
/* Square A(17.40,78.40) B(17.40,78.41) C(17.41,78.41) D(17.41,78.40).
   Start A, visit C, B, D, back to A: A-C and B-D are the two diagonals and
   they cross. The best tour is the perimeter. */
const A = { id: "A", lat: 17.40, lng: 78.40 }, B = { id: "B", lat: 17.40, lng: 78.41 };
const C = { id: "C", lat: 17.41, lng: 78.41 }, D = { id: "D", lat: 17.41, lng: 78.40 };
const crossedKm = R.pathKm(A, [C, B, D], true);
const fixed = R.twoOpt(A, [C, B, D], { returnToStart: true });
const perimeter = R.pathKm(A, [B, C, D], true);
check("fixed tour is shorter than the crossed one", fixed.km < crossedKm, true);
check("fixed tour is the perimeter", Math.abs(fixed.km - perimeter) < 1e-9, true);
check("fixed order walks round the square",
      ["B,C,D", "D,C,B"].indexOf(ids(fixed.order).join(",")) !== -1, true);
/* open path: A -> C -> B -> D crosses too; best open path is A-B-C-D or A-D-C-B */
const openFixed = R.twoOpt(A, [C, B, D], { returnToStart: false });
check("open path uncrossed as well",
      ["B,C,D", "D,C,B"].indexOf(ids(openFixed.order).join(",")) !== -1, true);

/* ---------- 6. estimate ---------- */
console.log("\nestimate()");
const est = R.estimate({ km: 10, order: [] }, [
  { capacity: 240, fill: 100 }, { capacity: 120, fill: 50 }, { capacity: 80, fill: 90 }
]);
check("roadKm = km x 1.35", est.roadKm, 13.5);
check("minutes = 13.5 km at 22 km/h + 4 min x 3 stops", est.minutes, Math.round(13.5 / 22 * 60 + 12));
check("litres = sum(capacity x fill/100) = 240 + 60 + 72", est.litres, 372);
check("empty plan estimates to zero", R.estimate({ km: 0, order: [] }), { roadKm: 0, minutes: 0, litres: 0 });
check("stops default to plan.order",
      R.estimate({ km: 0, order: [{ capacity: 100, fill: 40 }] }).litres, 40);

/* ---------- 7. legs ---------- */
console.log("\nlegs() - splitting into Google Maps links");
const t25 = randomStops(25, 7);
const L9 = R.legs(DEPOT, t25, { maxWaypoints: 9 });
check("25 stops, 9 waypoints -> 3 legs", L9.length, 3);
check("legs of 10, 10, 5 stops", L9.map(l => l.stops.length), [10, 10, 5]);
check("legs are numbered from 1", L9.map(l => l.index), [1, 2, 3]);
check("legs keep the visiting order", ids([].concat.apply([], L9.map(l => l.stops))), ids(t25));
check("25 stops, 3 waypoints -> 7 legs", R.legs(DEPOT, t25, { maxWaypoints: 3 }).length, 7);
check("default is 9 waypoints", R.legs(DEPOT, t25, {}).length, 3);
check("no stops -> no legs", R.legs(DEPOT, [], {}), []);
check("maxWaypoints above Google's 9 is clamped", R.legs(DEPOT, t25, { maxWaypoints: 50 }).length, 3);

const LR = R.legs(DEPOT, t25, { maxWaypoints: 9, returnToStart: true });
const lastLeg = LR[LR.length - 1];
check("returnToStart: last destination is the start",
      [lastLeg.destination.lat, lastLeg.destination.lng], [DEPOT.lat, DEPOT.lng]);
check("returnToStart: flagged on the last leg only", LR.map(l => l.returnsToStart), [false, false, true]);
check("returnToStart: the start is not counted as a bin", lastLeg.stops.length, 5);
check("returnToStart: last URL ends at the depot",
      lastLeg.url.indexOf("destination=17.407800%2C78.475500") !== -1, true);

const LO = R.legs(DEPOT, t25, { maxWaypoints: 9, includeOrigin: true });
check("includeOrigin: leg 1 starts at the start", [LO[0].origin.lat, LO[0].origin.lng], [DEPOT.lat, DEPOT.lng]);
check("includeOrigin: leg 2 starts where leg 1 ended", LO[1].origin, LO[0].destination);
check("includeOrigin: no dir_action (route preview)", LO.every(l => l.url.indexOf("dir_action") === -1), true);
check("default: no origin, dir_action=navigate",
      L9.every(l => l.url.indexOf("origin=") === -1 && l.url.indexOf("&dir_action=navigate") !== -1), true);

/* ---------- 8. URL format ---------- */
console.log("\nGoogle Maps URL format");
const u = R.mapsUrl(null, { lat: 17.4239, lng: 78.4738 },
                    [{ lat: 17.4065, lng: 78.4772 }, { lat: 17.3616, lng: 78.4747 }], {});
check("exact URL",
      u, "https://www.google.com/maps/dir/?api=1&destination=17.423900%2C78.473800" +
         "&waypoints=17.406500%2C78.477200%7C17.361600%2C78.474700&travelmode=driving&dir_action=navigate");
check("api=1 is the first parameter", u.indexOf("https://www.google.com/maps/dir/?api=1&"), 0);
const query = u.split("?")[1];
check("no raw '|' or ',' anywhere", /[|,]/.test(query), false);
check("coordinates have 6 decimals and %2C",
      (query.match(/-?\d+\.\d{6}%2C-?\d+\.\d{6}/g) || []).length, 3);
check("waypoints separated by %7C", query.indexOf("%7C") !== -1, true);
check("travelmode=driving", query.indexOf("travelmode=driving") !== -1, true);
const withOrigin = R.mapsUrl(DEPOT, one, [], { navigate: true });
check("origin given -> no dir_action even if asked", withOrigin.indexOf("dir_action"), -1);
check("origin given -> origin parameter present", withOrigin.indexOf("&origin=17.407800%2C78.475500") !== -1, true);
check("no waypoints -> no waypoints parameter", withOrigin.indexOf("waypoints"), -1);
check("navigate:false with no origin -> no dir_action",
      R.mapsUrl(null, one, [], { navigate: false }).indexOf("dir_action"), -1);
const allUrls = L9.concat(LR, LO, R.legs(DEPOT, t25, { maxWaypoints: 3 })).map(l => l.url);
check("every generated URL <= 2048 characters", allUrls.every(x => x.length <= 2048), true);
check("every generated URL starts with api=1", allUrls.every(x => x.indexOf("?api=1&") !== -1), true);
check("every generated URL is free of raw '|' and ','", allUrls.every(x => !/[|,]/.test(x)), true);
check("negative coordinates keep their sign",
      R.mapsUrl(null, { lat: -33.8688, lng: 151.2093 }, [], {}).indexOf("-33.868800%2C151.209300") !== -1, true);

console.log("\n----------------------------------------");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("----------------------------------------\n");
process.exit(fail ? 1 : 0);
