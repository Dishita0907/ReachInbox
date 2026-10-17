import "dotenv/config";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Redis } from "ioredis";

import {
  reserveSendPermission,
  closeSendPermission
} from "./sendPermission.js";

const senderId = randomUUID();

async function main() {
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379)
  });

  const options = {
    hourlyLimit: 2,
    minimumDelayMs: 500
  };

  try {
    console.log("Testing hourly limit: 2");
    console.log("Testing minimum delay: 500 ms");

    // Three workers ask for permission together.
    const results = await Promise.all([
      reserveSendPermission(senderId, options),
      reserveSendPermission(senderId, options),
      reserveSendPermission(senderId, options)
    ]);

    const allowed = results.filter(
      (result) => result.allowed
    ).length;

    const waiting = results.filter(
      (result) => result.reason === "minimum_delay"
    ).length;

    console.log("Immediately allowed:", allowed);
    console.log("Waiting for delay:", waiting);

    if (allowed !== 1 || waiting !== 2) {
      throw new Error("Concurrent permission test failed");
    }

    // Wait long enough to reserve the second slot.
    await sleep(600);

    const second = await reserveSendPermission(
      senderId,
      options
    );

    console.log(
      "Second permission granted:",
      second.allowed ? "YES" : "NO"
    );

    if (!second.allowed || second.used !== 2) {
      throw new Error("Second sending slot failed");
    }

    // Wait for delay to expire again.
    await sleep(600);

    // Hourly quota is now exhausted.
    const third = await reserveSendPermission(
      senderId,
      options
    );

    console.log("Third permission reason:", third.reason);
    console.log("Hourly slots used:", third.used);

    if (
      third.allowed ||
      third.reason !== "hourly_limit" ||
      third.used !== 2 ||
      third.retryAfterMs <= 0
    ) {
      throw new Error("Hourly limit was not enforced");
    }

    console.log(
      "SUCCESS: Combined sending safeguards enforced!"
    );

    console.log("No SMTP emails were sent.");
  } finally {
    // Clean up only this test sender's Redis keys.
    const hourlyKeys = await redis.keys(
      `reachinbox:gate:hourly:${senderId}:*`
    );

    const keys = [
      ...hourlyKeys,
      `reachinbox:gate:delay:${senderId}`
    ];

    await redis.del(...keys);

    console.log("Temporary Redis test data removed.");

    await redis.quit();
    await closeSendPermission();
  }
}

main().catch((error) => {
  console.error("Permission test failed:", error);
  process.exitCode = 1;
});
