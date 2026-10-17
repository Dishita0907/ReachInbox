import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";

import {
  reserveHourlySlot,
  getConfiguredHourlyLimit,
  closeHourlyRateLimiter
} from "./hourlyRateLimit.js";

const testSenderId = randomUUID();

async function main() {
  const cleanupRedis = new Redis({
    host: process.env.REDIS_HOST ?? "127.0.0.1",
    port: Number(process.env.REDIS_PORT ?? 6379)
  });

  try {
    console.log(
      "Configured production hourly limit:",
      getConfiguredHourlyLimit()
    );

    console.log("Testing with limit: 2");

    // Simulate three workers reserving simultaneously
    const results = await Promise.all([
      reserveHourlySlot(testSenderId, 2),
      reserveHourlySlot(testSenderId, 2),
      reserveHourlySlot(testSenderId, 2)
    ]);

    const allowed = results.filter(
      (result) => result.allowed
    ).length;

    const blocked = results.filter(
      (result) => !result.allowed
    ).length;

    console.log("Allowed requests:", allowed);
    console.log("Blocked requests:", blocked);
    console.log(
      "Maximum used slots:",
      Math.max(...results.map((result) => result.used))
    );

    if (allowed !== 2 || blocked !== 1) {
      throw new Error("Hourly rate-limit test failed");
    }

    const rejected = results.find(
      (result) => !result.allowed
    );

    console.log(
      "Blocked request can retry at:",
      rejected?.nextHourAt
    );

    console.log(
      "SUCCESS: Redis hourly rate limit enforced!"
    );
  } finally {
    // Remove only counters belonging to our random test sender
    const testKeys = await cleanupRedis.keys(
      `reachinbox:hourly:${testSenderId}:*`
    );

    if (testKeys.length > 0) {
      await cleanupRedis.del(...testKeys);
    }

    console.log("Temporary test counters cleaned up.");

    await cleanupRedis.quit();
    await closeHourlyRateLimiter();
  }
}

main().catch((error) => {
  console.error("Rate-limit test failed:", error);
  process.exitCode = 1;
});
