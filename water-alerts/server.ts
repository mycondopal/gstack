// Water-station low-water alert service. Single-file Bun HTTP server:
// ingests load-cell weight readings, converts to level via calibration, raises
// threshold alerts, pushes them live, and serves a dashboard.
//
//   bun run water-alerts/server.ts   ->   http://localhost:8787

import { join } from "node:path";
import {
  ackAlert,
  calibrateClient,
  listAlerts,
  listClients,
  openAlertCount,
  recordReading,
  upsertClient,
  type Reading,
} from "./store.ts";
import { notifyAlert, subscribe } from "./notifier.ts";

const PORT = Number(process.env.PORT ?? 8787);
const PUBLIC_DIR = join(import.meta.dir, "public");

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    // --- API ---------------------------------------------------------------
    if (pathname === "/api/health") {
      return json({ ok: true, openAlerts: openAlertCount() });
    }

    if (pathname === "/api/readings" && req.method === "POST") {
      let body: { deviceId?: string; weightG?: number; battery?: number; ts?: number };
      try {
        body = await req.json();
      } catch {
        return badRequest("body must be JSON");
      }
      if (!body.deviceId || typeof body.deviceId !== "string") {
        return badRequest("deviceId is required");
      }
      if (typeof body.weightG !== "number" || body.weightG < 0) {
        return badRequest("weightG must be a non-negative number (grams)");
      }
      const reading: Reading = {
        weightG: body.weightG,
        battery: typeof body.battery === "number" ? body.battery : undefined,
        ts: typeof body.ts === "number" ? body.ts : Date.now(),
      };
      const alert = recordReading(body.deviceId, reading);
      if (alert) notifyAlert(alert);
      return json({ ok: true, alertRaised: alert });
    }

    if (pathname === "/api/clients" && req.method === "GET") {
      return json({ clients: listClients() });
    }

    // Register / rename a client, set threshold, or seed calibration weights.
    if (pathname === "/api/clients" && req.method === "POST") {
      let body: {
        deviceId?: string;
        name?: string;
        thresholdPct?: number;
        tareG?: number;
        fullG?: number;
      };
      try {
        body = await req.json();
      } catch {
        return badRequest("body must be JSON");
      }
      if (!body.deviceId) return badRequest("deviceId is required");
      const client = upsertClient(body);
      return json({ ok: true, client });
    }

    // Calibrate: capture the current (or supplied) weight as empty/full.
    const calMatch = pathname.match(/^\/api\/clients\/([^/]+)\/calibrate$/);
    if (calMatch && req.method === "POST") {
      let body: { mode?: "empty" | "full"; weightG?: number };
      try {
        body = await req.json();
      } catch {
        return badRequest("body must be JSON");
      }
      if (body.mode !== "empty" && body.mode !== "full") {
        return badRequest('mode must be "empty" or "full"');
      }
      const client = calibrateClient(
        decodeURIComponent(calMatch[1]),
        body.mode,
        body.weightG,
      );
      if (!client) return json({ error: "client not found" }, 404);
      return json({ ok: true, client });
    }

    if (pathname === "/api/alerts" && req.method === "GET") {
      return json({ alerts: listAlerts() });
    }

    const ackMatch = pathname.match(/^\/api\/alerts\/([^/]+)\/ack$/);
    if (ackMatch && req.method === "POST") {
      const alert = ackAlert(decodeURIComponent(ackMatch[1]));
      if (!alert) return json({ error: "alert not found" }, 404);
      return json({ ok: true, alert });
    }

    // --- Live push stream (SSE) -------------------------------------------
    // The dashboard subscribes here and fires a browser notification the moment
    // an alert lands. Real "push to the app," no polling delay.
    if (pathname === "/api/stream") {
      let cleanup = () => {};
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          const send = (obj: unknown) =>
            controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
          send({ type: "hello" });
          const unsub = subscribe((alert) => send({ type: "alert", alert }));
          // Keepalive so proxies don't drop an idle connection.
          const ka = setInterval(
            () => controller.enqueue(enc.encode(`: ping\n\n`)),
            25_000,
          );
          cleanup = () => {
            clearInterval(ka);
            unsub();
          };
        },
        cancel() {
          cleanup();
        },
      });
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      });
    }

    // --- Static dashboard --------------------------------------------------
    if (req.method === "GET") {
      const rel = pathname === "/" ? "/index.html" : pathname;
      const file = Bun.file(join(PUBLIC_DIR, rel));
      if (await file.exists()) return new Response(file);
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`water-alerts service on http://localhost:${server.port}`);
