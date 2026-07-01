// In-memory store with JSON-file persistence. Deliberately dependency-free so
// the MVP runs with nothing but Bun. Swap for a real DB when clients > a few
// hundred or when multiple server instances need to share state.
//
// Sensor model: a LOAD CELL sits under the jug and reports total WEIGHT in
// grams. That weight = tare (empty bottle + platform) + water weight. We
// calibrate each client once (capture weight empty -> tare, full -> full),
// then convert any reading to a level percentage:
//
//     level% = (weightG - tareG) / (fullG - tareG) * 100
//
// When the level drops to the client's threshold, the jug is "light enough"
// and we raise a refill alert.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_FILE = join(import.meta.dir, "data.json");

export type Reading = {
  weightG: number; // total weight on the load cell, grams
  battery?: number;
  ts: number; // epoch ms
};

export type Client = {
  deviceId: string;
  name: string; // human label the station recognizes ("Acme Corp — 3rd floor")
  thresholdPct: number; // raise an alert at or below this level
  tareG?: number; // weight of the empty bottle + platform (calibrated)
  fullG?: number; // weight when full (calibrated)
  latest?: Reading;
  status: "ok" | "low" | "stale" | "uncalibrated" | "unknown";
};

export type Alert = {
  id: string;
  deviceId: string;
  clientName: string;
  level: number; // percent full at the moment the alert fired
  weightG: number; // measured weight at that moment
  thresholdPct: number;
  raisedAt: number;
  ackedAt?: number; // set when the station dispatches a refill
};

// What we hand the dashboard: a client plus derived fields it shouldn't compute.
export type ClientView = Client & {
  level: number | null; // null until calibrated
  triggerWeightG: number | null; // weight at which an alert fires
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

/** Convert a raw weight to a level %, or null if the client isn't calibrated. */
export function levelFor(client: Client, weightG: number): number | null {
  const { tareG, fullG } = client;
  if (tareG == null || fullG == null || fullG <= tareG) return null;
  const pct = ((weightG - tareG) / (fullG - tareG)) * 100;
  return Math.max(0, Math.min(100, pct));
}

/** The weight at which this client crosses its threshold, or null if uncalibrated. */
function triggerWeight(client: Client): number | null {
  const { tareG, fullG } = client;
  if (tareG == null || fullG == null || fullG <= tareG) return null;
  return tareG + (client.thresholdPct / 100) * (fullG - tareG);
}

/** Register a client for a device, or update its label/threshold/calibration. */
export function upsertClient(input: {
  deviceId: string;
  name?: string;
  thresholdPct?: number;
  tareG?: number;
  fullG?: number;
}): Client {
  const existing = db.clients[input.deviceId];
  const client: Client = {
    deviceId: input.deviceId,
    name: input.name ?? existing?.name ?? input.deviceId,
    thresholdPct: input.thresholdPct ?? existing?.thresholdPct ?? 20,
    tareG: input.tareG ?? existing?.tareG,
    fullG: input.fullG ?? existing?.fullG,
    latest: existing?.latest,
    status: existing?.status ?? "unknown",
  };
  db.clients[input.deviceId] = client;
  persist();
  return client;
}

/**
 * Calibrate a client by capturing a reference weight. `mode: "empty"` sets the
 * tare (empty bottle on the scale), `mode: "full"` sets the full weight. If
 * `weightG` is omitted we use the latest reading — matches the physical flow of
 * "put the empty jug on, tap Set Empty."
 */
export function calibrateClient(
  deviceId: string,
  mode: "empty" | "full",
  weightG?: number,
): Client | null {
  const client = db.clients[deviceId];
  if (!client) return null;
  const w = weightG ?? client.latest?.weightG;
  if (w == null) return client; // nothing to capture yet
  if (mode === "empty") client.tareG = w;
  else client.fullG = w;
  persist();
  return client;
}

/**
 * Record a reading. Auto-registers unknown devices so a freshly-installed
 * sensor shows up immediately (the station calibrates + renames it later).
 * Returns any alert newly raised by this reading, or null.
 */
export function recordReading(
  deviceId: string,
  reading: Reading,
): Alert | null {
  let client = db.clients[deviceId];
  if (!client) client = upsertClient({ deviceId });
  client.latest = reading;

  const level = levelFor(client, reading.weightG);
  if (level == null) {
    // Can't judge fullness without calibration — surface it, don't alert.
    client.status = "uncalibrated";
    persist();
    return null;
  }

  const wasLow = client.status === "low";
  const isLow = level <= client.thresholdPct;
  client.status = isLow ? "low" : "ok";

  let newAlert: Alert | null = null;
  // Edge-triggered: raise one alert on the ok->low transition, not on every
  // low reading, so the station isn't spammed while a jug sits empty.
  if (isLow && !wasLow && !openAlertFor(deviceId)) {
    newAlert = {
      id: `a${++db.seq}`,
      deviceId,
      clientName: client.name,
      level,
      weightG: reading.weightG,
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

/** Clients with freshly-computed status + derived level/trigger weight. */
export function listClients(now = Date.now()): ClientView[] {
  return Object.values(db.clients).map((c) => {
    const level = c.latest ? levelFor(c, c.latest.weightG) : null;
    let status = c.status;
    if (!c.latest) status = "unknown";
    else if (level == null) status = "uncalibrated";
    else if (now - c.latest.ts > STALE_AFTER_MS) status = "stale";
    return { ...c, status, level, triggerWeightG: triggerWeight(c) };
  });
}

export function listAlerts(): Alert[] {
  return db.alerts.slice(0, 100);
}

export function openAlertCount(): number {
  return db.alerts.filter((a) => !a.ackedAt).length;
}
