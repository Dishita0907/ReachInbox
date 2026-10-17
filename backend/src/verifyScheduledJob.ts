import { pool } from "./db.js";
import { emailQueue } from "./emailQueue.js";

async function verifyScheduledJob() {
  try {
    await emailQueue.waitUntilReady();

    // Find our scheduled test email in PostgreSQL
    const result = await pool.query(
      `SELECT id, recipient_email, status, scheduled_at
       FROM email_jobs
       WHERE recipient_email = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      ["recipient@example.test"]
    );

    if (result.rows.length === 0) {
      throw new Error("Test email not found in PostgreSQL");
    }

    const email = result.rows[0];

    // Find the matching job in BullMQ
    const job = await emailQueue.getJob(email.id);

    if (!job) {
      throw new Error("Matching BullMQ job not found");
    }

    const jobState = await job.getState();

    console.log("PostgreSQL email ID:", email.id);
    console.log("Database status:", email.status);
    console.log("BullMQ job ID:", job.id);
    console.log("BullMQ job state:", jobState);

    if (
      email.id !== job.id ||
      job.data.emailJobId !== email.id ||
      email.status !== "scheduled" ||
      jobState !== "delayed"
    ) {
      throw new Error("Scheduled email verification failed");
    }

    console.log("SUCCESS: PostgreSQL and BullMQ match!");
  } catch (error) {
    console.error("Verification failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

verifyScheduledJob();
