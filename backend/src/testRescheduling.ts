import "dotenv/config";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Queue, Worker, DelayedError } from "bullmq";
import { Redis } from "ioredis";

import {
  reserveSendPermission,
  closeSendPermission
} from "./sendPermission.js";

const senderId = randomUUID();

// Use a unique, isolated test queue.
const queueName =
  "reachinbox-reschedule-test-" +
  randomUUID().replace(/-/g, "");

const connection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null
};

async function main() {
  const queue = new Queue(queueName, { connection });
  const redis = new Redis(connection);

  let worker: Worker | undefined;

  try {
    worker = new Worker(
      queueName,
      async (job, token) => {
        const permission = await reserveSendPermission(
          senderId,
          {
            hourlyLimit: 1,
            minimumDelayMs: 100
          }
        );

        if (!permission.allowed) {
          if (!token) {
            throw new Error("Missing BullMQ worker lock");
          }

          const retryTime =
            Date.now() +
            Math.max(1000, permission.retryAfterMs) +
            1000;

          // Return this job to BullMQ's delayed queue.
          await job.moveToDelayed(retryTime, token);

          throw new DelayedError();
        }

        // Simulate processing. No SMTP sending.
        return { simulated: true };
      },
      {
        connection,
        concurrency: 2
      }
    );

    await Promise.all([
      queue.waitUntilReady(),
      worker.waitUntilReady()
    ]);

    console.log("Rescheduling test worker started.");

    // Add two test jobs for one sender.
    const first = await queue.add(
      "test-email",
      { message: "First simulated email" }
    );

    const second = await queue.add(
      "test-email",
      { message: "Second simulated email" }
    );

    let states = ["", ""];

    // Wait up to 10 seconds for the expected states.
    for (let i = 0; i < 100; i++) {
      states = [
        await first.getState(),
        await second.getState()
      ];

      if (
        states.includes("completed") &&
        states.includes("delayed")
      ) {
        break;
      }

      await sleep(100);
    }

    console.log("First job state:", states[0]);
    console.log("Second job state:", states[1]);

    const completed =
      states.filter((state) => state === "completed").length;

    const delayed =
      states.filter((state) => state === "delayed").length;

    console.log("Completed simulated jobs:", completed);
    console.log("Delayed jobs:", delayed);

    if (completed !== 1 || delayed !== 1) {
      throw new Error("Rescheduling test failed");
    }

    console.log(
      "SUCCESS: Rate-limited job rescheduled!"
    );

    console.log("No SMTP emails were sent.");
  } finally {
    // Stop the isolated test worker.
    if (worker) {
      await worker.close();
    }

    // Clean up this unique test queue.
    await queue.obliterate({ force: true });
    await queue.close();

    // Remove only this test sender's Redis counters.
    const hourlyKeys = await redis.keys(
      `reachinbox:gate:hourly:${senderId}:*`
    );

    if (hourlyKeys.length > 0) {
      await redis.del(...hourlyKeys);
    }

    await redis.del(
      `reachinbox:gate:delay:${senderId}`
    );

    await redis.quit();
    await closeSendPermission();

    console.log("Temporary test data cleaned up.");
  }
}

main().catch((error) => {
  console.error("Rescheduling test failed:", error);
  process.exitCode = 1;
});
