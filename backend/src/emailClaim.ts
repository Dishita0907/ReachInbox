import { pool } from "./db.js";

// Represents an email successfully claimed by a worker
export interface ClaimedEmail {
  id: string;
  user_id: string;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  send_attempts: number;
}

// Claim an email only if it is due and not already claimed
export async function claimScheduledEmail(
  emailJobId: string
): Promise<ClaimedEmail | null> {
  const result = await pool.query<ClaimedEmail>(
    `UPDATE email_jobs
     SET
       status = 'processing',
       sending_started_at = NOW(),
       send_attempts = send_attempts + 1,
       updated_at = NOW()
     WHERE id = $1
       AND status = 'scheduled'
       AND scheduled_at <= NOW()
       AND send_attempts = 0
     RETURNING
       id,
       user_id,
       sender_id,
       recipient_email,
       subject,
       body,
       scheduled_at,
       send_attempts`,
    [emailJobId]
  );

  // Only one competing worker can receive the email.
  return result.rows[0] ?? null;
}
