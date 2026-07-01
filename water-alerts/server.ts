// Water-station low-water alert service. Single-file Bun HTTP server:
// ingests sensor readings, raises threshold alerts, serves a live dashboard.
//
//   bun run water-alerts/server.ts   ->   http://localhost:8787

import { join } from "node:path";
import {
  ackAlert,
  listAlerts,
  listClients,
  openAlertCount,
  recordReading,
  upsertClient,
  type Reading,
} from "./store.ts";

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
      let body: Partial<Reading> & { deviceId?: string };
      try {
        body = await req.json();
      } catch {
        return badRequest("body must be JSON");
      }
      if (!body.deviceId || typeof body.deviceId !== "string") {
        return badRequest("deviceId is required");
      }
      if (typeof body.level !== "number" || body.level < 0 || body.level > 100) {
        return badRequest("level must be a number 0-100");
      }
      const reading: Reading = {
        level: body.level,
        battery: typeof body.battery === "number" ? body.battery : undefined,
        ts: typeof body.ts === "number" ? body.ts : Date.now(),
      };
      const alert = recordReading(body.deviceId, reading);
      return json({ ok: true, alertRaised: alert });
    }

    if (pathname === "/api/clients" && req.method === "GET") {
      return json({ clients: listClients() });
    }

    // Register / rename a client, or set its refill threshold.
    if (pathname === "/api/clients" && req.method === "POST") {
      let body: { deviceId?: string; name?: string; thresholdPct?: number };
      try {
        body = await req.json();
      } catch {
        return badRequest("body must be JSON");
      }
      if (!body.deviceId) return badRequest("deviceId is required");
      const threshold =
        typeof body.thresholdPct === "number" ? body.thresholdPct : 20;
      const client = upsertClient(
        body.deviceId,
        body.name ?? body.deviceId,
        threshold,
      );
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
