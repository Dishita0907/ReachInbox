import { emailQueue } from "./emailQueue.js";

async function checkQueue() {
  try {
    // Wait until Redis connection is ready
    await emailQueue.waitUntilReady();

    console.log("BullMQ connected to Redis successfully!");
    console.log("Queue name:", emailQueue.name);

    // Retrieve current job counts
    const counts = await emailQueue.getJobCounts(
      "waiting",
      "delayed",
      "active",
      "completed",
      "failed"
    );

    console.log("Queue job counts:", counts);

  } catch (error) {
    console.error("BullMQ connection failed:", error);
    process.exitCode = 1;

  } finally {
    await emailQueue.close();
  }
}

checkQueue();
