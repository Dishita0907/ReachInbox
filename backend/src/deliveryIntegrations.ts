import "dotenv/config";

import { createDecipheriv } from "node:crypto";
import { Client } from "@elastic/elasticsearch";
import { pool } from "./db.js";

const INDEX_NAME = "reachinbox-email-jobs-v1";
const searchClient = new Client({
  node: process.env.ELASTICSEARCH_URL ?? "http://127.0.0.1:9200"
});

type DeliveryEmail = {
  id: string;
  user_id: string;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  scheduled_at: Date | string;
  sent_at: Date | string | null;
  created_at: Date | string;
  webhook_enc: string | null;
};

function iso(value: Date | string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}

function decryptWebhook(encrypted: string): string {
  const hexKey = process.env.SLACK_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hexKey)) {
    throw new Error("SLACK_ENCRYPTION_KEY is missing or invalid");
  }
  const parts = encrypted.split(":");
  if (parts.length !== 3 || parts.some((part) => !/^[0-9a-f]+$/i.test(part))) {
    throw new Error("Invalid encrypted Slack webhook format");
  }
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(hexKey, "hex"),
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final()
  ]).toString("utf8");
  const url = new URL(decrypted);
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com" ||
      !url.pathname.startsWith("/services/")) {
    throw new Error("Unsafe Slack webhook URL");
  }
  return url.toString();
}

async function updateSearch(email: DeliveryEmail): Promise<void> {
  await searchClient.index({
    index: INDEX_NAME,
    id: email.id,
    refresh: "wait_for",
    document: {
      emailJobId: email.id,
      userId: email.user_id,
      senderId: email.sender_id,
      recipientEmail: email.recipient_email,
      subject: email.subject,
      body: email.body,
      status: email.status,
      scheduledAt: iso(email.scheduled_at),
      sentAt: iso(email.sent_at),
      createdAt: iso(email.created_at)
    }
  });
  console.log("Elasticsearch updated for email:", email.id, email.status);
}

async function notifySlack(email: DeliveryEmail): Promise<void> {
  if (!email.webhook_enc) {
    console.log("Slack notification skipped (no connection):", email.id);
    return;
  }

  // Claim once so the same job event does not send duplicate notifications.
  const claimed = await pool.query(
    `UPDATE email_jobs
     SET slack_notified_status = status
     WHERE id = $1
       AND status IN ('sent', 'failed')
       AND slack_notified_status IS DISTINCT FROM status
     RETURNING id`,
    [email.id]
  );
  if (claimed.rowCount !== 1) return;

  try {
    const url = decryptWebhook(email.webhook_enc);
    const ok = email.status === "sent";
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `${ok ? "✅ Email sent" : "❌ Email failed"}\n` +
          `Subject: ${email.subject}\n` +
          `To: ${email.recipient_email}`
      }),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.text();
    if (!response.ok || result.trim() !== "ok") {
      throw new Error(`Slack webhook rejected request (${response.status})`);
    }
    console.log("Slack notification posted for email:", email.id);
  } catch (error) {
    // Permit a later explicit retry if the webhook request did not succeed.
    await pool.query(
      `UPDATE email_jobs SET slack_notified_status = NULL
       WHERE id = $1 AND slack_notified_status = $2`,
      [email.id, email.status]
    ).catch(() => undefined);
    throw error;
  }
}

/** Best-effort side effects: never throw into the SMTP/BullMQ processor. */
export async function syncDeliveryOutcome(emailId: string): Promise<void> {
  const result = await pool.query<DeliveryEmail>(
    `SELECT e.id, e.user_id, e.sender_id, e.recipient_email,
            e.subject, e.body, e.status, e.scheduled_at,
            e.sent_at, e.created_at, sc.webhook_enc
     FROM email_jobs e
     LEFT JOIN slack_connections sc ON sc.user_id = e.user_id
     WHERE e.id = $1`,
    [emailId]
  );
  const email = result.rows[0];
  if (!email || (email.status !== "sent" && email.status !== "failed")) return;

  const outcomes = await Promise.allSettled([
    updateSearch(email),
    notifySlack(email)
  ]);
  const labels = ["Elasticsearch", "Slack"];
  outcomes.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      const message = outcome.reason instanceof Error ? outcome.reason.message : "Unknown error";
      console.error(`${labels[index]} side effect failed for ${emailId}: ${message}`);
    }
  });
}
