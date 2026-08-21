# 2. Industry Relevance

The prototype is a bin on a desk. The idea behind it is a **connected asset
that reports its own state**, which is the single most common pattern in
industrial IoT. Once you can answer "how full is asset #4,312 right now?"
without sending a person to look, the same architecture applies to fuel tanks,
grain silos, water reservoirs, vending machines and parcel lockers.

---

## Sector by sector

### Smart city waste management
The flagship use case. Bins report fill levels; a routing engine builds a
collection route each morning from the bins that actually need emptying. The
gain is not one big saving but three compounding ones: fewer kilometres
driven, fewer vehicle-hours, and no overflow complaints. Cities that have
deployed sensor-based routing consistently report large reductions in the
number of collection trips, because a substantial share of scheduled visits
turn out to be unnecessary.

### Hospitals
Two separate wins. Touchless operation removes a hand-contact surface from
wards, corridors and pathology labs, which matters for infection control.
Separately, clinical and biomedical waste is legally required to be removed
before it overflows; a bin that raises its own alert creates an audit trail
that a paper log book cannot.

### Airports
An international terminal may hold several hundred bins, and their filling is
extremely uneven: bins near the security queue fill in an hour, bins near a
quiet gate take three days. Fixed rounds cannot cope with that spread.
Level data lets a small cleaning team cover a large terminal properly.

### Railway and metro stations
High footfall, minimal staff, and platforms where an overflowing bin is both a
safety hazard and a very visible failure. Alerts also make it possible to
correlate waste volume with train timetables and plan staffing around peaks.

### Shopping malls
Food courts are the pressure point. Housekeeping is normally dispatched on a
rota; with sensors they are dispatched to the three bins that need attention.
The same dashboard gives mall management footfall-adjacent data for free -
lid-open counts are a decent proxy for how busy an area is.

### Office buildings
Facilities teams spend a surprising amount of time on inspection rounds that
find nothing. Removing those rounds is a direct labour saving, and the
touchless lid is a visible amenity that staff notice immediately.

### Educational campuses
This is where the project sits naturally. A campus can deploy a handful of
bins as a live sustainability project, run the dashboard on a spare machine,
and let each new batch of students extend it. Low risk, visible outcome, real
data to analyse.

### Industrial facilities
Segregated waste streams - metal swarf, solvent-soaked rags, packaging -
each have different regulatory handling rules. Monitoring each stream
separately produces the evidence needed for compliance reporting, and full-bin
alerts stop a hazardous stream being over-filled.

### Public sanitation
Parks, beaches, markets and festival grounds all share a pattern: demand is
extremely spiky and staff are thin. Sensors let a small crew respond to actual
demand rather than guess.

---

## Business value

| Value | Mechanism | Who feels it |
|---|---|---|
| **Touchless operation** | Servo lid replaces a hand-contact surface | Every user; infection control teams |
| **Better hygiene** | Fewer contact points, no overflow onto floors | Public health, facilities |
| **Less manual monitoring** | Inspection rounds replaced by a dashboard | Supervisors, housekeeping |
| **Improved collection efficiency** | Routes built from live fill data | Fleet managers, finance |
| **Reduced overflow** | Alert fires at 90 %, before the failure | Municipality, brand reputation |
| **Maintenance efficiency** | Lid-open counts and battery levels predict service needs | Maintenance teams |
| **Auditability** | Every alert and collection is timestamped | Compliance, ESG reporting |
| **Data for planning** | Fill-rate history shows where more bins are needed | Urban planners |

---

## Where the money actually comes from

It is worth being precise in an interview, because "it saves money" is a weak
answer. The savings decompose into:

1. **Avoided trips.** If a third of scheduled visits are to bins under 40 %
   full, those trips are pure cost. Sensors delete them.
2. **Shorter routes.** Visiting only the bins that need it also shortens the
   route between them, so the saving is more than proportional.
3. **Deferred capacity.** Knowing which bins fill fastest tells you where a
   larger bin is needed, instead of adding vehicles.
4. **Avoided penalties.** Overflow complaints and compliance failures carry
   direct costs in many municipal contracts.

Against that sits the cost of the sensor unit, its battery or power supply,
connectivity, and the dashboard. The honest engineering statement is that the
economics work best on **high-traffic, hard-to-predict bins** and worst on
quiet bins with a predictable schedule - which is why real deployments
instrument a subset of the fleet, not all of it.

---

## What a production version would add

The prototype is deliberately simple. A commercial unit would add:

- **Low-power design.** Deep sleep between measurements, waking every few
  minutes, so one battery lasts a year instead of a week.
- **Long-range connectivity.** LoRaWAN or NB-IoT instead of Wi-Fi, because
  street furniture has no access point nearby.
- **Weather-proofing.** IP65+ enclosure, and temperature compensation for the
  speed of sound, which changes about 0.6 m/s per °C.
- **Tamper and fire detection.** Accelerometer plus a temperature sensor -
  bin fires are a real and expensive problem.
- **Secure OTA updates.** Signed firmware images, because a fleet you cannot
  update is a fleet you cannot fix.
- **Fleet identity and authentication.** Per-device certificates rather than a
  shared key.
