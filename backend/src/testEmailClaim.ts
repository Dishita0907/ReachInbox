import { randomUUID } from "node:crypto";
import { pool } from "./db.js";
import { claimScheduledEmail } from "./emailClaim.js";

async function main() {
  const testIds: string[] = [];

  try {
    // Find our existing development sender
    const senders = await pool.query<{
      id: string;
      user_id: string;
    }>(
      `SELECT id, user_id
       FROM sender_accounts
       WHERE from_email = $1
       LIMIT 2`,
      ["sender@example.test"]
    );

    if (senders.rows.length !== 1) {
      throw new Error(
        "Expected exactly one development sender"
      );
    }

    const sender = senders.rows[0];

    // Create two database-only test emails
    const dueId = randomUUID();
    const futureId = randomUUID();

    const insertEmail = async (
      id: string,
      scheduledAt: Date
    ) => {
      await pool.query(
        `INSERT INTO email_jobs (
           id, user_id, sender_id,
           recipient_email, subject, body,
           scheduled_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id,
          sender.user_id,
          sender.id,
          "recipient@example.test",
          "ReachInbox Worker Claim Test",
          "Database-only test. Do not send.",
          scheduledAt
        ]
      );

      testIds.push(id);
    };

    // One email is already due
    await insertEmail(
      dueId,
      new Date(Date.now() - 60_000)
    );

    // One email is scheduled an hour later
    await insertEmail(
      futureId,
      new Date(Date.now() + 3_600_000)
    );

    // Simulate two workers trying simultaneously
    const claims = await Promise.all([
      claimScheduledEmail(dueId),
      claimScheduledEmail(dueId)
    ]);

    const successfulClaims =
      claims.filter((claim) => claim !== null).length;

    const saved = await pool.query(
      `SELECT status, send_attempts
       FROM email_jobs
       WHERE id = $1`,
      [dueId]
    );

    // Make sure a future email cannot be claimed early
    const futureClaim = await claimScheduledEmail(futureId);

    console.log(
      "Successful competing claims:",
      successfulClaims
    );

    console.log(
      "Database status:",
      saved.rows[0].status
    );

    console.log(
      "Send attempt count:",
      saved.rows[0].send_attempts
    );

    console.log(
      "Future email claimed:",
      futureClaim ? "YES" : "NO"
    );

    if (
      successfulClaims !== 1 ||
      saved.rows[0].status !== "processing" ||
      saved.rows[0].send_attempts !== 1 ||
      futureClaim !== null
    ) {
      throw new Error("Claim safety test failed");
    }

    console.log(
      "SUCCESS: Duplicate claims prevented!"
    );

    console.log(
      "SUCCESS: Future emails cannot be claimed early!"
    );
  } finally {
    // Remove only the temporary test records
    if (testIds.length > 0) {
      const deleted = await pool.query(
        `DELETE FROM email_jobs
         WHERE id = ANY($1::uuid[])
           AND subject = 'ReachInbox Worker Claim Test'
         RETURNING id`,
        [testIds]
      );

      console.log(
        "Temporary records removed:",
        deleted.rowCount
      );
    }

    await pool.end();
  }
}

main().catch((error) => {
  console.error("Claim test failed:", error);
  process.exitCode = 1;
});
