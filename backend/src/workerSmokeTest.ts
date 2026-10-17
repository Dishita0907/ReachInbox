import "dotenv/config";

import { Queue, Worker, QueueEvents } from "bullmq";

// Use a separate test queue.
// Our real email queue will remain untouched.
const QUEUE_NAME = "reachinbox-worker-test";

const connection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null
};

// Configurable number of jobs processed in parallel
const concurrency = Number(
  process.env.WORKER_CONCURRENCY ?? 2
);

if (!Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 50) {
  throw new Error("WORKER_CONCURRENCY must be between 1 and 50");
}

async function main() {
  const queue = new Queue(QUEUE_NAME, { connection });

  const events = new QueueEvents(QUEUE_NAME, {
    connection
  });

  const worker = new Worker(
    QUEUE_NAME,

    async (job) => {
      if (job.name !== "smoke-test") {
        throw new Error("Unknown test job");
      }

      console.log("Worker received job:", job.id);
      console.log("Message:", job.data.message);

      return {
        success: true,
        message: "Test job processed successfully"
      };
    },

    {
      connection,
      concurrency
    }
  );

  worker.on("error", (error) => {
    console.error("Worker error:", error.message);
  });

  try {
    await Promise.all([
      queue.waitUntilReady(),
      events.waitUntilReady(),
      worker.waitUntilReady()
    ]);

    console.log("BullMQ worker connected to Redis!");
    console.log("Worker concurrency:", concurrency);

    // Add one harmless test job
    const job = await queue.add(
      "smoke-test",
      {
        message: "Hello from ReachInbox Worker!"
      }
    );

    console.log("Test job created:", job.id);

    // Wait for the worker to complete the job
    const result = await job.waitUntilFinished(
      events,
      20000
    );

    console.log("Worker result:", result);

    if (result.success !== true) {
      throw new Error("Worker test failed");
    }

    console.log("SUCCESS: BullMQ worker is working!");

    // Remove only our completed test job
    await job.remove();

    console.log("Test job cleaned up.");
  } finally {
    await worker.close();
    await events.close();
    await queue.close();
  }
}

main().catch((error) => {
  console.error("Worker test failed:", error);
  process.exitCode = 1;
});
