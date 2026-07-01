// In-memory store with JSON-file persistence. Deliberately dependency-free so
// the MVP runs with nothing but Bun. Swap for a real DB when clients > a few
// hundred or when multiple server instances need to share state.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_FILE = join(import.meta.dir, "data.json");

export type Reading = {
  level: number; // percent full, 0-100
  battery?: number;
  ts: number; // epoch ms
};

export type Client = {
  deviceId: string;
  name: string; // human label the station recognizes ("Acme Corp — 3rd floor")
  thresholdPct: number; // raise an alert at or below this level
  latest?: Reading;
  status: "ok" | "low" | "stale" | "unknown";
};

export type Alert = {
  id: string;
  deviceId: string;
  clientName: string;
  level: number;
  thresholdPct: number;
  raisedAt: number;
  ackedAt?: number; // set when the station dispatches a refill
};

type DB = {
  clients: Record<string, Client>;
  alerts: Alert[];
  seq: number; // monotonic id counter for alerts
};

// A device is "stale" if we haven't heard from it in this long. Real sensors
// report on an interval; silence usually means dead battery or lost signal,
// which the station wants to know about too.
export const STALE_AFTER_MS = 60_000;

let db: DB = load();

function load(): DB {
  if (existsSync(DATA_FILE)) {
    try {
      return JSON.parse(readFileSync(DATA_FILE, "utf-8")) as DB;
    } catch {
      // Corrupt/partial file — start clean rather than crash the service.
    }
  }
  return { clients: {}, alerts: [], seq: 0 };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  // Debounce writes: a burst of readings shouldn't hammer the disk.
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }, 250);
}

/** Register a client for a device, or update its label/threshold. */
export function upsertClient(
  deviceId: string,
  name: string,
  thresholdPct: number,
): Client {
  const existing = db.clients[deviceId];
  const client: Client = {
    deviceId,
    name,
    thresholdPct,
    latest: existing?.latest,
    status: existing?.status ?? "unknown",
  };
  db.clients[deviceId] = client;
  persist();
  return client;
}

/**
 * Record a reading. Auto-registers unknown devices so a freshly-installed
 * sensor shows up immediately (the station renames it later). Returns any
 * alert newly raised by this reading, or null.
 */
export function recordReading(
  deviceId: string,
  reading: Reading,
): Alert | null {
  let client = db.clients[deviceId];
  if (!client) {
    client = upsertClient(deviceId, deviceId, 20);
  }
  client.latest = reading;

  const wasLow = client.status === "low";
  const isLow = reading.level <= client.thresholdPct;
  client.status = isLow ? "low" : "ok";

  let newAlert: Alert | null = null;
  // Edge-triggered: raise one alert on the ok->low transition, not on every
  // low reading, so the station isn't spammed while a jug sits empty.
  if (isLow && !wasLow && !openAlertFor(deviceId)) {
    newAlert = {
      id: `a${++db.seq}`,
      deviceId,
      clientName: client.name,
      level: reading.level,
      thresholdPct: client.thresholdPct,
      raisedAt: reading.ts,
    };
    db.alerts.unshift(newAlert);
  }
  persist();
  return newAlert;
}

function openAlertFor(deviceId: string): Alert | undefined {
  return db.alerts.find((a) => a.deviceId === deviceId && !a.ackedAt);
}

/** Acknowledge an alert (station dispatched a refill). */
export function ackAlert(id: string): Alert | null {
  const alert = db.alerts.find((a) => a.id === id);
  if (!alert || alert.ackedAt) return alert ?? null;
  alert.ackedAt = Date.now();
  persist();
  return alert;
}

/** Clients with a freshly-computed status (marks stale devices). */
export function listClients(now = Date.now()): Client[] {
  return Object.values(db.clients).map((c) => {
    let status = c.status;
    if (!c.latest) status = "unknown";
    else if (now - c.latest.ts > STALE_AFTER_MS) status = "stale";
    return { ...c, status };
  });
}

export function listAlerts(): Alert[] {
  return db.alerts.slice(0, 100);
}

export function openAlertCount(): number {
  return db.alerts.filter((a) => !a.ackedAt).length;
}
