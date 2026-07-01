// Fake fleet of load-cell sensors. Stands in for real hardware until we build
// it. Each virtual jug sits on a scale reporting total WEIGHT in grams; it
// drains over time, and when nearly empty the station "refills" it (weight
// jumps back to full). This exercises the full ingest -> calibrate -> threshold
// -> alert -> push loop the real devices will drive.
//
//   bun run water-alerts/simulator.ts   (server must already be running)
//
// Weight model: a 5-gallon jug holds ~18.9 L of water (~18,900 g). The empty
// polycarbonate bottle + scale platform is the tare (~800 g). So a full jug on
// the scale reads ~19,700 g, an empty one ~800 g.

const BASE = process.env.BASE_URL ?? "http://localhost:8787";
const TICK_MS = Number(process.env.TICK_MS ?? 1500);

const EMPTY_G = 800; // tare: empty bottle + platform
const FULL_WATER_G = 18_900; // water in a full 5-gallon jug
const FULL_G = EMPTY_G + FULL_WATER_G;

type Jug = {
  deviceId: string;
  name: string;
  thresholdPct: number;
  weightG: number;
  drainPerTickG: number; // g/tick — different clients drink at different rates
  battery: number;
};

const jugs: Jug[] = [
  { deviceId: "jug-0001", name: "Acme Corp — Reception", thresholdPct: 20, weightG: FULL_G * 0.92, drainPerTickG: 700, battery: 88 },
  { deviceId: "jug-0002", name: "Bright Dental Clinic", thresholdPct: 25, weightG: FULL_G * 0.60, drainPerTickG: 400, battery: 74 },
  { deviceId: "jug-0003", name: "Sunrise Yoga Studio", thresholdPct: 15, weightG: FULL_G * 0.40, drainPerTickG: 950, battery: 91 },
  { deviceId: "jug-0004", name: "Harbor Law Offices", thresholdPct: 20, weightG: FULL_G * 0.78, drainPerTickG: 250, battery: 55 },
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
  // Register clients with labels, thresholds, AND calibration (tare + full) so
  // the dashboard shows real percentages immediately. In the field, calibration
  // is a one-time "Set empty / Set full" tap per install instead.
  for (const j of jugs) {
    await post("/api/clients", {
      deviceId: j.deviceId,
      name: j.name,
      thresholdPct: j.thresholdPct,
      tareG: EMPTY_G,
      fullG: FULL_G,
    });
  }
  console.log(`Simulating ${jugs.length} load-cell sensors against ${BASE} every ${TICK_MS}ms`);

  setInterval(async () => {
    for (const j of jugs) {
      // Refill once a jug is nearly empty (the station just delivered water).
      if (j.weightG <= EMPTY_G + 300) {
        j.weightG = FULL_G - 200;
        console.log(`  ↺ ${j.name} refilled`);
      } else {
        // Slight jitter so lines aren't perfectly straight.
        const noise = (j.deviceId.charCodeAt(4) % 5) * 10;
        j.weightG = Math.max(EMPTY_G, j.weightG - j.drainPerTickG - noise);
      }
      j.battery = Math.max(0, j.battery - 0.01);
      await post("/api/readings", {
        deviceId: j.deviceId,
        weightG: Math.round(j.weightG),
        battery: Number(j.battery.toFixed(1)),
      });
    }
  }, TICK_MS);
}

main();
