// Fake fleet of water sensors. Stands in for real hardware until we build it.
// Each virtual jug drains over time; when the station "refills" it (we simulate
// that when it bottoms out), the level jumps back up. This exercises the full
// ingest -> threshold -> alert -> clear loop the real devices will drive.
//
//   bun run water-alerts/simulator.ts   (server must already be running)

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const TICK_MS = Number(process.env.TICK_MS ?? 1500);

type Jug = {
  deviceId: string;
  name: string;
  thresholdPct: number;
  level: number;
  drainPerTick: number; // %/tick — different clients drink at different rates
  battery: number;
};

const jugs: Jug[] = [
  { deviceId: "jug-0001", name: "Acme Corp — Reception", thresholdPct: 20, level: 92, drainPerTick: 3.5, battery: 88 },
  { deviceId: "jug-0002", name: "Bright Dental Clinic", thresholdPct: 25, level: 60, drainPerTick: 2.0, battery: 74 },
  { deviceId: "jug-0003", name: "Sunrise Yoga Studio", thresholdPct: 15, level: 40, drainPerTick: 5.0, battery: 91 },
  { deviceId: "jug-0004", name: "Harbor Law Offices", thresholdPct: 20, level: 78, drainPerTick: 1.2, battery: 55 },
];

async function post(path: string, body: unknown) {
  try {
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.error(`POST ${path} failed — is the server running?`, err);
  }
}

async function main() {
  // Register clients with their labels + thresholds up front.
  for (const j of jugs) {
    await post("/api/clients", {
      deviceId: j.deviceId,
      name: j.name,
      thresholdPct: j.thresholdPct,
    });
  }
  console.log(`Simulating ${jugs.length} sensors against ${BASE} every ${TICK_MS}ms`);

  setInterval(async () => {
    for (const j of jugs) {
      // Refill once a jug is nearly empty (the station just delivered water).
      if (j.level <= 3) {
        j.level = 95;
        console.log(`  ↺ ${j.name} refilled`);
      } else {
        // Slight jitter so lines aren't perfectly straight.
        const noise = (j.deviceId.charCodeAt(4) % 5) / 10;
        j.level = Math.max(0, j.level - j.drainPerTick - noise);
      }
      j.battery = Math.max(0, j.battery - 0.01);
      await post("/api/readings", {
        deviceId: j.deviceId,
        level: Number(j.level.toFixed(1)),
        battery: Number(j.battery.toFixed(1)),
      });
    }
  }, TICK_MS);
}

main();
