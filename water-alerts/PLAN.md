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

## Sensing: load cell (chosen)

**Decision: a load cell (weigh scale) under the jug.** The bottle sits on a
platform with a load cell; it reports total weight, and the service converts
weight to level via a per-client calibration (empty + full). Why this over the
alternatives:

- **Load cell / weigh scale (chosen)** — robust, no contact with water, and it
  survives the jug being swapped out (the defining trait of the 5-gallon cooler
  use case). Cheap HX711 amplifier + a bar load cell is a well-trodden path.
- **Hydrostatic pressure sensor** — reads water height in a **fixed tank**. Clean
  mapping, but assumes a permanent known-geometry tank, not a swappable jug.
- **Ultrasonic distance** — measures the air gap from the top; needs a stable
  mount and clear line of sight.
- **Float switch** — dead simple but binary (one trip point), no gradual level.

The device only ever reports raw `weightG`; the app owns calibration and the
level math. So the threshold or calibration can change with zero firmware
updates, and we could swap the sensing method later without touching firmware.

### Hardware sketch (load cell path)

- **Load cell + HX711** 24-bit amplifier under the bottle platform.
- **MCU**: ESP32 (has deep-sleep; wake on interval, read, transmit, sleep).
- **Connectivity**: LTE-M module (see below) so there's no WiFi setup.
- **Power**: battery; deep-sleep between readings is what makes a year of life
  plausible. Report every ~15–30 min, not continuously.
- **Calibration**: one-time "Set empty / Set full" from the dashboard at install
  (already built), stored server-side against the deviceId.

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

1. **✅ Software MVP (this).** Weight ingest → calibration → threshold → alert →
   dashboard + live push, fake load-cell sensor.
2. **✅ Push notifications (this).** Live browser push via `/api/stream`, plus an
   `ALERT_WEBHOOK` sink for SMS/Slack/ntfy. Native APNs/FCM added with a mobile app.
3. **Auth + multi-station.** Right now anyone can POST. Add a device API key per
   sensor and a login for the station dashboard before any real device ships.
4. **One hardware prototype.** ESP32 + load cell (HX711) + LTE-M modem. POST the
   same `/api/readings` contract. Prove battery life and signal in a real location.
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
