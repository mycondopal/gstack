# Water Station Low-Water Alerts — MVP

Proactive refill alerts for a water refilling / delivery business. A sensor on
each client's container reports its water **level** to this service. When a
client drops below their refill threshold, the service raises an **alert** and
the station sees it on a live dashboard, so they dispatch a refill exactly when
it's needed instead of guessing.

> **Status: software MVP.** The sensor is a **load cell under the jug** that
> reports weight; it's simulated in software (`simulator.ts`) for now. The whole
> pipeline — ingest → calibrate → threshold → alert → push — is real. Swap the
> simulator for real hardware later; the HTTP ingest contract stays the same.

## How the load-cell sensing works

A load cell (weight scale) sits under the jug and reports **total weight**. That
weight is the empty bottle + platform (the *tare*) plus the water. Calibrate each
client once — capture weight **empty** and weight **full** — and the service
converts any reading to a level:

```
level% = (weightG - tareG) / (fullG - tareG) * 100
```

When the level drops to the client's threshold (the jug is "light enough"), an
alert fires and a **push notification** goes out. On the dashboard, calibrate
with the **Set empty** / **Set full** buttons; in the field that's a one-time
tap per install.

## Why this shape

The app is the cheap, low-risk part. The hardware (a reliable, battery-powered,
internet-connected level sensor) is the actual business and the expensive part.
So we build and prove the software flow first, with a fake sensor, and only
commit to hardware once the alert experience is validated. See
[PLAN.md](./PLAN.md) for the product + hardware roadmap.

## Run it

Requires [Bun](https://bun.sh) (already used by this repo).

```bash
# Terminal 1 — start the service + dashboard
bun run water-alerts/server.ts
# open http://localhost:8787

# Terminal 2 — start the fake sensors (they drain and refill over time)
bun run water-alerts/simulator.ts
```

Watch the dashboard: clients drain toward their threshold, flip to **LOW**
(raising an alert), then get "refilled" and reset. That end-to-end loop is
exactly what real hardware will drive.

## The ingest contract (what real hardware must send)

A device POSTs a raw weight. This is the ONLY thing hardware has to implement:

```
POST /api/readings
Content-Type: application/json

{
  "deviceId": "jug-0007",     // stable per-device id
  "weightG": 3820,            // total weight on the load cell, grams
  "battery": 82,              // optional, percent
  "ts": 1751328000000         // optional, epoch ms; server stamps if absent
}
```

The server maps `deviceId` -> client, converts `weightG` to a level using that
client's calibration, compares against its threshold, and raises alerts. The
device never has to know its own fullness — it just reports raw weight, so
calibration can change without a firmware update.

## API

| Method | Path                     | Purpose                                  |
|--------|--------------------------|------------------------------------------|
| POST   | `/api/readings`             | Ingest one load-cell weight reading      |
| GET    | `/api/clients`              | All clients + latest level + status      |
| POST   | `/api/clients`              | Register/rename, set threshold or calibration |
| POST   | `/api/clients/:id/calibrate`| Capture current weight as `empty`/`full` |
| GET    | `/api/alerts`               | Open + recent alerts                     |
| POST   | `/api/alerts/:id/ack`       | Acknowledge (dispatch) an alert          |
| GET    | `/api/stream`               | Live SSE push feed of new alerts         |
| GET    | `/api/health`               | Liveness                                 |

**Push notifications.** New alerts stream over `/api/stream`; the dashboard pops
a browser notification instantly. Set `ALERT_WEBHOOK=<url>` to also POST each
alert to Slack / Twilio (SMS) / ntfy / Discord — that's how a phone gets buzzed
without native-app plumbing. A native mobile app adds an APNs/FCM sink later.

State persists to `water-alerts/data.json` (git-ignored) so a restart doesn't
lose clients or alert history.
