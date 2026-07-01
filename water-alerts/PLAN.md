# Product + hardware roadmap

This MVP proves the **software** half of the idea. The **hardware** half is the
real business and the real risk. This doc lays out both so the next decision is
informed, not guessed.

## The core insight

A water refilling / delivery business loses money two ways: **empty containers**
(angry customers, churn) and **wasted trips** (topping up a jug that was still
half full). Both come from *not knowing the real level at each client.* A cheap
level sensor that phones home turns reactive guessing into proactive dispatch.
Same play as smart propane monitors (Tank Utility) and smart heating-oil sensors.

## Where the money and risk actually are

| Part | Difficulty | Cost | Notes |
|------|-----------|------|-------|
| App + dashboard | Low | ~free | This MVP. A weekend, done. |
| Backend / alerting | Low | cheap to host | This MVP. Scales fine to hundreds of clients on one box. |
| **Sensor hardware** | **High** | **$$$** | Reliable, cheap, battery-powered, self-connecting. This is the business. |
| **Connectivity** | **High** | recurring | No customer WiFi setup allowed. Cellular or LoRa. Drives cost + battery. |
| Install / support | Medium | labor | Someone mounts the sensor and it must "just work" for a year. |

Build order follows risk: software first (done), then a **single** hardware
prototype, then a 5–10 unit field pilot, only then scale.

## Sensing options (pick per container type)

- **Load cell / weigh scale** — put the jug/bottle on a scale, infer level from
  weight. Best for **swappable 5-gallon jugs** on coolers. Robust, no contact
  with water, survives jug swaps. Recommended default for the cooler use case.
- **Hydrostatic pressure sensor** — reads water height at the bottom of a
  **fixed tank**. Clean level mapping, but assumes a permanent, known-geometry
  tank. Good for reservoirs, not swappable jugs.
- **Ultrasonic distance** — measures air gap above the water from the top.
  No water contact, works across container shapes, but needs a stable mount and
  clear line of sight.
- **Float switch** — dead simple, cheap, but binary (above/below one point), no
  gradual level. Fine as a v0 "it's low" trigger.

The server already abstracts all of these to a single `level` percentage, so the
sensing choice can change without touching the app.

## Connectivity — the make-or-break

Requiring the customer's WiFi password kills adoption. Ranked:

1. **Cellular LTE-M / NB-IoT** — device works out of the box anywhere with
   coverage. Recurring SIM cost (~$1–3/mo/device) but zero setup. Best UX.
2. **LoRaWAN** — cheap radios, long range, one gateway covers many sensors.
   Great if clients cluster geographically; you run/rent the gateway.
3. **WiFi** — cheapest radio, worst UX (provisioning, password changes break it).
   Only viable if the *station* owns the site (e.g. their own tanks).

Recommendation for a delivery business with scattered clients: **LTE-M**.

## Suggested build sequence

1. **✅ Software MVP (this).** Ingest → threshold → alert → dashboard, fake sensor.
2. **Auth + multi-station.** Right now anyone can POST. Add a device API key per
   sensor and a login for the station dashboard before any real device ships.
3. **Notifications.** SMS/push/email to the driver when an alert fires. The
   dashboard is the record; the notification is what actually triggers dispatch.
4. **One hardware prototype.** ESP32 + chosen sensor + LTE-M modem. POST the same
   `/api/readings` contract. Prove battery life and signal in a real location.
5. **5–10 unit pilot** with one friendly station. Measure: fewer empties, fewer
   wasted trips. That number is the pitch.
6. **Scale**: provisioning flow, fleet health (battery/stale device alerts —
   the "stale" status is already wired), billing.

## What this MVP intentionally skips (and should get before hardware)

- **No auth.** Ingest and dashboard are open. Add per-device keys + station login.
- **Single tenant.** One station's view. Multi-station needs an org model.
- **No outbound notifications.** Alerts live only in the dashboard so far.
- **In-file storage.** `data.json` is fine for a demo; move to SQLite/Postgres
  for a pilot.

None of these block the demo. All of them block real sensors in the field.
