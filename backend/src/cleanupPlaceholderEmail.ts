import { pool } from "./db.js";
import { emailQueue } from "./emailQueue.js";

async function main() {
  try {
    // Find the old placeholder email.
    const result = await pool.query(
      `SELECT e.id, e.status, e.send_attempts,
              e.recipient_email
       FROM email_jobs e
       JOIN sender_accounts s
         ON s.id = e.sender_id
       WHERE e.subject = $1
         AND s.from_email = $2`,
      [
        "ReachInbox Scheduling Test",
        "sender@example.test"
      ]
    );

    if (result.rows.length !== 1) {
      throw new Error(
        "Expected exactly one placeholder email. No changes made."
      );
    }

    const email = result.rows[0];

    if (
      email.status !== "scheduled" ||
      email.send_attempts !== 0 ||
      email.recipient_email !== "recipient@example.test"
    ) {
      throw new Error(
        "Email is not safe to remove. No changes made."
      );
    }

    const job = await emailQueue.getJob(email.id);

    if (
      !job ||
      job.name !== "send-email" ||
      job.data.emailJobId !== email.id ||
      (await job.getState()) !== "delayed"
    ) {
      throw new Error(
        "Matching delayed job not found. No changes made."
      );
    }

    console.log("Matching placeholder email and job found.");

    // Remove the scheduled BullMQ job first.
    await job.remove();
    console.log("Old BullMQ job removed.");

    // Remove only this specific email record.
    const deleted = await pool.query(
      `DELETE FROM email_jobs
       WHERE id = $1
         AND status = 'scheduled'
         AND send_attempts = 0
       RETURNING id`,
      [email.id]
    );

    if (deleted.rowCount !== 1) {
      throw new Error(
        "Database deletion incomplete. Inspect before retrying."
      );
    }

    console.log("Old PostgreSQL email removed.");
    console.log("SUCCESS: Placeholder email cleaned up!");
    console.log("Google user and sender accounts preserved.");
  } catch (error) {
    console.error("Cleanup failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

main();
