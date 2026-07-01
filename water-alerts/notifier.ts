// Push notifications for refill alerts. Three sinks, all best-effort:
//
//   1. console  — always, so you see it in the server log.
//   2. live stream (SSE) — the dashboard subscribes and pops a real browser
//      notification the instant a jug goes low. This is the "push to the app."
//   3. webhook — if ALERT_WEBHOOK is set, we POST the alert there. Point it at
//      Twilio (SMS to the driver), Slack, ntfy, Discord, whatever. This is how
//      a phone gets buzzed without us building APNs/FCM plumbing in the MVP.
//
// When you build a native mobile app later, add an APNs/FCM sink here — the
// alert shape stays the same.

import type { Alert } from "./store.ts";

type Subscriber = (alert: Alert) => void;
const subscribers = new Set<Subscriber>();

/** Dashboard clients subscribe to the live stream; returns an unsubscribe fn. */
export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function notifyAlert(alert: Alert): void {
  const kg = (alert.weightG / 1000).toFixed(1);
  console.log(
    `🔔 LOW WATER — ${alert.clientName}: ${alert.level.toFixed(0)}% (${kg}kg) ≤ ${alert.thresholdPct}%`,
  );

  for (const fn of subscribers) {
    try {
      fn(alert);
    } catch {
      // A wedged subscriber must not block the others or the request path.
    }
  }

  const webhook = process.env.ALERT_WEBHOOK;
  if (webhook) {
    // Fire-and-forget: a refill alert shouldn't fail because Slack is down.
    fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `💧 Low water: ${alert.clientName} at ${alert.level.toFixed(0)}% — dispatch a refill.`,
        alert,
      }),
    }).catch(() => {});
  }
}
