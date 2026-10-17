import { emailQueue } from "./emailQueue.js";

const JOB_ID = "phase5b-delay-test";
const DELAY = 60 * 60 * 1000; // One hour

async function main() {
  const action = process.argv[2];

  try {
    await emailQueue.waitUntilReady();

    if (action === "add") {
      const existing = await emailQueue.getJob(JOB_ID);

      if (existing) {
        console.log("Test job already exists.");
      } else {
        await emailQueue.add(
          "setup-delay-check",
          {
            message: "This is only a scheduling test."
          },
          {
            jobId: JOB_ID,
            delay: DELAY
          }
        );

        console.log("Delayed test job created!");
      }
    } else if (action === "remove") {
      const job = await emailQueue.getJob(JOB_ID);

      if (job) {
        await job.remove();
        console.log("Test job removed successfully!");
      } else {
        console.log("Test job does not exist.");
      }
    } else if (action !== "check") {
      console.log("Use: add, check, or remove");
      return;
    }

    if (action !== "remove") {
      const job = await emailQueue.getJob(JOB_ID);

      if (job) {
        console.log("Job ID:", job.id);
        console.log("Job state:", await job.getState());
      } else {
        console.log("Job not found.");
      }
    }

    const counts = await emailQueue.getJobCounts(
      "waiting",
      "delayed",
      "active",
      "completed",
      "failed"
    );

    console.log("Queue counts:", counts);
  } catch (error) {
    console.error("Test failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
  }
}

main();
