import "dotenv/config";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Redis } from "ioredis";

import {
  reserveSendStart,
  getMinimumSendDelay,
  closeSendDelayConnection
} from "./minimumSendDelay.js";

const senderId = randomUUID();

async function main() {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379)
  });

  try {
    const delayMs = getMinimumSendDelay();

    console.log("Configured minimum delay:", delayMs, "ms");

    // Simulate three workers trying at the same time.
    const results = await Promise.all([
      reserveSendStart(senderId),
      reserveSendStart(senderId),
      reserveSendStart(senderId)
    ]);

    const allowed = results.filter(
      (result) => result.allowed
    ).length;

    const blocked = results.filter(
      (result) => !result.allowed
    ).length;

    console.log("Immediately allowed:", allowed);
    console.log("Required to wait:", blocked);

    if (allowed !== 1 || blocked !== 2) {
      throw new Error("Concurrent send-delay test failed");
    }

    // Wait slightly longer than the configured delay.
    await sleep(delayMs + 200);

    const next = await reserveSendStart(senderId);

    console.log(
      "Allowed after waiting:",
      next.allowed ? "YES" : "NO"
    );

    if (!next.allowed) {
      throw new Error("Delay did not expire correctly");
    }

    console.log(
      "SUCCESS: Minimum send delay enforced!"
    );

    console.log("No SMTP emails were sent.");
  } finally {
    await redis.del(`reachinbox:send-delay:${senderId}`);
    console.log("Temporary delay record cleaned up.");

    await redis.quit();
    await closeSendDelayConnection();
  }
}

main().catch((error) => {
  console.error("Send delay test failed:", error);
  process.exitCode = 1;
});
