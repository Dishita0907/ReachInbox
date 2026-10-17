import "dotenv/config";
import { pool } from "./db.js";
import { emailQueue } from "./emailQueue.js";

async function main() {
  try {
    await emailQueue.waitUntilReady();

    const result = await pool.query(
      `SELECT
         e.id,
         e.subject,
         e.status,
         e.send_attempts,
         e.scheduled_at,
         s.from_email
       FROM email_jobs e
       JOIN sender_accounts s
         ON e.sender_id = s.id
       WHERE e.subject = $1
       ORDER BY e.created_at DESC
       LIMIT 2`,
      ["ReachInbox E2E Worker Test"]
    );

    if (result.rows.length !== 1) {
      throw new Error(
        "Expected exactly one E2E test email. Found: " +
        result.rows.length
      );
    }

    const email = result.rows[0];

    const correctSender =
      email.from_email === process.env.ETHEREAL_USER;

    const job = await emailQueue.getJob(email.id);
    const jobState = job ? await job.getState() : "missing";

    console.log("Email ID:", email.id);
    console.log("Database status:", email.status);
    console.log("Send attempts:", email.send_attempts);
    console.log("Correct Ethereal sender:", correctSender ? "YES" : "NO");
    console.log("BullMQ job state:", jobState);
    console.log("Scheduled at:", email.scheduled_at);

    if (
      !correctSender ||
      email.status !== "scheduled" ||
      email.send_attempts !== 0 ||
      !job ||
      job.id !== email.id ||
      job.name !== "send-email" ||
      job.data.emailJobId !== email.id ||
      !["delayed", "waiting"].includes(jobState)
    ) {
      throw new Error("Scheduled email verification failed");
    }

    console.log("SUCCESS: Email is ready for worker testing!");
    console.log("No email was sent during verification.");
  } catch (error) {
    console.error("Verification failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

main();
