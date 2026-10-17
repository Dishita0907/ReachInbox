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
         s.display_name AS sender
       FROM email_jobs e
       JOIN sender_accounts s
         ON s.id = e.sender_id
       ORDER BY e.created_at DESC`
    );

    console.log("Database emails:", result.rows.length);

    for (const email of result.rows) {
      const job = await emailQueue.getJob(email.id);

      console.log("------------------------");
      console.log("Email ID:", email.id);
      console.log("Subject:", email.subject);
      console.log("Sender:", email.sender);
      console.log("Status:", email.status);
      console.log("Send attempts:", email.send_attempts);
      console.log(
        "BullMQ job:",
        job ? await job.getState() : "NOT FOUND"
      );

      if (job && job.data.emailJobId !== email.id) {
        console.log("WARNING: Queue job ID mismatch");
      }
    }

    const queued = await emailQueue.getJobs(
      ["delayed", "waiting"],
      0,
      49
    );

    console.log("------------------------");
    console.log("Queued delayed/waiting jobs:", queued.length);

    for (const job of queued) {
      console.log("Queue job ID:", job.id);
      console.log("Email reference:", job.data.emailJobId);
    }

    console.log("Inspection complete. No changes made.");
  } catch (error) {
    console.error("Inspection failed:", error);
    process.exitCode = 1;
  } finally {
    await emailQueue.close();
    await pool.end();
  }
}

main();
