import "dotenv/config";
import { pool } from "./db.js";
import { emailQueue } from "./emailQueue.js";

async function main() {
  try {
    await emailQueue.waitUntilReady();

    // Find only the old placeholder test emails.
    const result = await pool.query(
      `SELECT e.id, e.status, e.send_attempts,
              e.subject, e.recipient_email
       FROM email_jobs e
       JOIN sender_accounts s ON s.id = e.sender_id
       WHERE s.from_email = $1
         AND e.subject = $2`,
      [
        "sender@example.test",
        "ReachInbox Scheduling Test"
      ]
    );

    const emails = result.rows;

    if (emails.length !== 2) {
      throw new Error(
        `Expected 2 placeholder emails, found ${emails.length}. No changes made.`
      );
    }

    const counts = await emailQueue.getJobCounts(
      "waiting", "delayed", "active"
    );

    if (
      counts.delayed !== 2 ||
      counts.waiting !== 0 ||
      counts.active !== 0
    ) {
      throw new Error(
        "Unexpected queue counts. No changes made."
      );
    }

    // Verify everything before deleting.
    for (const email of emails) {
      if (
        email.status !== "scheduled" ||
        email.send_attempts !== 0 ||
        email.recipient_email !== "recipient@example.test"
      ) {
        throw new Error("Unsafe email state. No changes made.");
      }

      const job = await emailQueue.getJob(email.id);

      if (
        !job ||
        job.name !== "send-email" ||
        job.data.emailJobId !== email.id ||
        (await job.getState()) !== "delayed"
      ) {
        throw new Error(
          "Queue verification failed. No changes made."
        );
      }
    }

    console.log("Verified both placeholder emails.");

    // Remove both BullMQ jobs.
    for (const email of emails) {
      const job = await emailQueue.getJob(email.id);
      if (!job) {
        throw new Error("Job disappeared during cleanup.");
      }
      await job.remove();
    }

    console.log("Removed 2 BullMQ jobs.");

    // Remove only the two verified database records.
    const deleted = await pool.query(
      `DELETE FROM email_jobs
       WHERE id = ANY($1::uuid[])
         AND status = 'scheduled'
         AND send_attempts = 0
       RETURNING id`,
      [emails.map((email) => email.id)]
    );

    console.log("Database records removed:", deleted.rowCount);

    if (deleted.rowCount !== 2) {
      throw new Error("Database cleanup incomplete.");
    }

    console.log("SUCCESS: Both test emails cleaned up!");
    console.log("No SMTP emails were sent.");
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

main();
