import { pool } from "./db.js";
import { emailQueue } from "./emailQueue.js";

const TEST_EMAIL_ID =
  "76ba823a-c19d-4b65-979f-f0177003ca72";

async function cleanup() {
  try {
    // Find our specific test email
    const result = await pool.query(
      `SELECT id, recipient_email, subject, status
       FROM email_jobs
       WHERE id = $1`,
      [TEST_EMAIL_ID]
    );

    const email = result.rows[0];

    if (
      !email ||
      email.recipient_email !== "recipient@example.test" ||
      email.subject !== "ReachInbox Scheduling Test" ||
      email.status !== "scheduled"
    ) {
      throw new Error(
        "Test email does not match. No changes made."
      );
    }

    // Find the matching BullMQ job
    const job = await emailQueue.getJob(TEST_EMAIL_ID);

    if (
      !job ||
      job.data.emailJobId !== TEST_EMAIL_ID ||
      (await job.getState()) !== "delayed"
    ) {
      throw new Error(
        "Matching delayed BullMQ job not found. No changes made."
      );
    }

    // Remove the queue job first
    await job.remove();
    console.log("BullMQ test job removed.");

    // Remove the test email from PostgreSQL
    const deleted = await pool.query(
      `DELETE FROM email_jobs
       WHERE id = $1 AND status = 'scheduled'
       RETURNING id`,
      [TEST_EMAIL_ID]
    );

    if (deleted.rowCount !== 1) {
      throw new Error(
        "Database cleanup incomplete. Check PostgreSQL."
      );
    }

    console.log("PostgreSQL test email removed.");

    // Verify both removals
    const remainingJob = await emailQueue.getJob(TEST_EMAIL_ID);

    const remainingEmail = await pool.query(
      "SELECT id FROM email_jobs WHERE id = $1",
      [TEST_EMAIL_ID]
    );

    console.log(
      "BullMQ job remaining:",
      remainingJob ? "YES" : "NO"
    );

    console.log(
      "PostgreSQL email remaining:",
      remainingEmail.rowCount === 0 ? "NO" : "YES"
    );

    if (!remainingJob && remainingEmail.rowCount === 0) {
      console.log("SUCCESS: Test email cleaned up!");
    }
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

cleanup();
