# Water Station Low-Water Alerts — MVP

Proactive refill alerts for a water refilling / delivery business. A sensor on
each client's container reports its water **level** to this service. When a
client drops below their refill threshold, the service raises an **alert** and
the station sees it on a live dashboard, so they dispatch a refill exactly when
it's needed instead of guessing.

> **Status: software MVP.** The sensor is simulated in software
> (`simulator.ts`). The whole alert pipeline — ingest → threshold → alert →
> dashboard — is real. Swap the simulator for real hardware later; the HTTP
> ingest contract stays the same.

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

A device POSTs a reading. This is the ONLY thing hardware has to implement:

```
POST /api/readings
Content-Type: application/json

{
  "deviceId": "jug-0007",     // stable per-device id
  "level": 18.5,              // percent full, 0-100
  "battery": 82,              // optional, percent
  "ts": 1751328000000         // optional, epoch ms; server stamps if absent
}
```

The server maps `deviceId` -> client, compares `level` to that client's
threshold, and raises/clears alerts. Everything else (dashboard, alert history)
is derived server-side.

## API

| Method | Path                     | Purpose                                  |
|--------|--------------------------|------------------------------------------|
| POST   | `/api/readings`          | Ingest one sensor reading                |
| GET    | `/api/clients`           | All clients + latest level + status      |
| GET    | `/api/alerts`            | Open + recent alerts                      |
| POST   | `/api/alerts/:id/ack`    | Acknowledge (dispatch) an alert          |
| GET    | `/api/health`            | Liveness                                 |

State persists to `water-alerts/data.json` (git-ignored) so a restart doesn't
lose clients or alert history.
