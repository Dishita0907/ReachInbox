import "dotenv/config";

import { randomUUID } from "node:crypto";
import { Queue, QueueEvents, Worker } from "bullmq";
import { pool } from "./db.js";
import { claimScheduledEmail } from "./emailClaim.js";

// Separate test queue: never use the real email queue here.
const QUEUE_NAME = "reachinbox-database-worker-test";
const TEST_SUBJECT = "ReachInbox Database Worker Test";

const connection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null
};

const emailId = randomUUID();

async function main() {
  const queue = new Queue(QUEUE_NAME, { connection });
  const events = new QueueEvents(QUEUE_NAME, { connection });

  let worker: Worker | undefined;

  try {
    // 1. Find our development sender
    const senders = await pool.query(
      `SELECT id, user_id
       FROM sender_accounts
       WHERE from_email = $1
       LIMIT 2`,
      ["sender@example.test"]
    );

    if (senders.rows.length !== 1) {
      throw new Error("Development sender not found or ambiguous");
    }

    const sender = senders.rows[0];

    // 2. Create a temporary database-only email
    await pool.query(
      `INSERT INTO email_jobs (
         id, user_id, sender_id,
         recipient_email, subject, body, scheduled_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        emailId,
        sender.user_id,
        sender.id,
        "recipient@example.test",
        TEST_SUBJECT,
        "Worker integration test. Do not send.",
        new Date(Date.now() - 60_000)
      ]
    );

    console.log("Temporary test email created.");

    // 3. Create a BullMQ worker
    worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        if (job.name !== "claim-test") {
          throw new Error("Unexpected test job");
        }

        const claimed = await claimScheduledEmail(
          job.data.emailJobId
        );

        if (!claimed) {
          throw new Error("Email could not be claimed");
        }

        console.log("Worker claimed email:", claimed.id);

        // No SMTP sending here!
        return {
          claimed: true,
          emailId: claimed.id
        };
      },
      {
        connection,
        concurrency: 2
      }
    );

    await Promise.all([
      queue.waitUntilReady(),
      events.waitUntilReady(),
      worker.waitUntilReady()
    ]);

    console.log("Database worker connected to Redis.");

    // 4. Add one job to our isolated test queue
    const job = await queue.add(
      "claim-test",
      { emailJobId: emailId },
      {
        jobId: emailId,
        removeOnComplete: false
      }
    );

    // 5. Wait for worker to finish
    const result = await job.waitUntilFinished(
      events,
      20000
    );

    // 6. Verify the database status
    const saved = await pool.query(
      `SELECT status, send_attempts
       FROM email_jobs
       WHERE id = $1`,
      [emailId]
    );

    const email = saved.rows[0];

    console.log("Database status:", email.status);
    console.log("Send attempts:", email.send_attempts);

    if (
      result.claimed !== true ||
      result.emailId !== emailId ||
      email.status !== "processing" ||
      email.send_attempts !== 1
    ) {
      throw new Error("Worker integration test failed");
    }

    console.log("SUCCESS: Worker claimed database email!");
    console.log("No SMTP email was sent.");

  } finally {
    // Stop the test worker before cleanup
    if (worker) {
      await worker.close();
    }

    // Remove this specific test queue job
    const job = await queue.getJob(emailId);

    if (job) {
      await job.remove();
      console.log("Temporary queue job removed.");
    }

    // Remove this specific test database record
    const deleted = await pool.query(
      `DELETE FROM email_jobs
       WHERE id = $1 AND subject = $2
       RETURNING id`,
      [emailId, TEST_SUBJECT]
    );

    console.log(
      "Temporary database records removed:",
      deleted.rowCount
    );

    await events.close();
    await queue.close();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Integration test failed:", error);
  process.exitCode = 1;
});
