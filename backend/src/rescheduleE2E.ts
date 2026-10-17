import "dotenv/config";
import { pool } from "./db.js";
import { emailQueue } from "./emailQueue.js";

async function main() {
  try {
    await emailQueue.waitUntilReady();

    const result = await pool.query(
      `SELECT e.id, e.status, e.send_attempts,
              e.scheduled_at, s.from_email
       FROM email_jobs e
       JOIN sender_accounts s ON e.sender_id = s.id
       WHERE e.subject = $1`,
      ["ReachInbox E2E Worker Test"]
    );

    if (result.rows.length !== 1) {
      throw new Error("Expected exactly one E2E test email");
    }

    const email = result.rows[0];

    if (
      email.status !== "scheduled" ||
      email.send_attempts !== 0 ||
      email.from_email !== process.env.ETHEREAL_USER
    ) {
      throw new Error("Email is not safe to reschedule");
    }

    const counts = await emailQueue.getJobCounts(
      "waiting", "active", "delayed"
    );

    if (
      counts.waiting !== 0 ||
      counts.active !== 0 ||
      counts.delayed !== 1
    ) {
      throw new Error("Unexpected queue state");
    }

    const job = await emailQueue.getJob(email.id);

    if (
      !job ||
      job.name !== "send-email" ||
      job.data.emailJobId !== email.id ||
      (await job.getState()) !== "delayed"
    ) {
      throw new Error("Matching delayed job not found");
    }

    const delay = 10 * 60 * 1000;
    const scheduledAt = new Date(Date.now() + delay);

    // Update the existing BullMQ job.
    await job.changeDelay(delay);

    // Update the matching PostgreSQL record.
    const updated = await pool.query(
      `UPDATE email_jobs
       SET scheduled_at = $2, updated_at = NOW()
       WHERE id = $1
         AND status = 'scheduled'
         AND send_attempts = 0
       RETURNING id`,
      [email.id, scheduledAt]
    );

    if (updated.rowCount !== 1) {
      throw new Error("Database rescheduling incomplete");
    }

    console.log("Email ID:", email.id);
    console.log("New scheduled time:", scheduledAt.toISOString());
    console.log("BullMQ state:", await job.getState());
    console.log("SUCCESS: Email rescheduled!");
    console.log("No email was sent.");
  } catch (error) {
    console.error("Rescheduling failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

main();
