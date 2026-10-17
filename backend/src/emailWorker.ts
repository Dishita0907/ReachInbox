import { syncDeliveryOutcome } from "./deliveryIntegrations.js";
import "dotenv/config";

import { Worker, DelayedError } from "bullmq";
import nodemailer from "nodemailer";

const QUEUE_NAME = "reachinbox-emails";

async function main() {
  // Safety: Do not start the worker unless explicitly enabled.
  if (process.env.EMAIL_WORKER_ENABLED !== "true") {
    console.log("Email worker is DISABLED.");
    console.log("No jobs will be processed or sent.");
    return;
  }

  const { pool } = await import("./db.js");
  const { claimScheduledEmail } =
    await import("./emailClaim.js");
  const {
    reserveSendPermission,
    closeSendPermission
  } = await import("./sendPermission.js");

  const concurrency = Number(
    process.env.WORKER_CONCURRENCY ?? 2
  );

  if (
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > 50
  ) {
    throw new Error("Invalid WORKER_CONCURRENCY");
  }

  const username = process.env.ETHEREAL_USER;
  const password = process.env.ETHEREAL_PASS;

  if (!username || !password) {
    throw new Error("Ethereal credentials missing");
  }

  const transporter = nodemailer.createTransport({
    host: "smtp.ethereal.email",
    port: 587,
    secure: false,
    auth: {
      user: username,
      pass: password
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000
  });

  // Verify SMTP before starting the worker.
  await transporter.verify();

  const worker = new Worker(
    QUEUE_NAME,

    async (job, token) => {
      if (job.name !== "send-email") {
        throw new Error("Unknown email job type");
      }

      const emailId = job.data.emailJobId;

      if (typeof emailId !== "string") {
        throw new Error("Missing email ID");
      }

      // 1. Retrieve the email and sender.
      const result = await pool.query(
        `SELECT
           e.id,
           e.sender_id,
           e.recipient_email,
           e.subject,
           e.body,
           e.status,
           e.scheduled_at,
           s.from_email,
           s.display_name
         FROM email_jobs e
         JOIN sender_accounts s
           ON s.id = e.sender_id
           AND s.user_id = e.user_id
         WHERE e.id = $1`,
        [emailId]
      );

      const email = result.rows[0];

      if (!email) {
        console.log("Email record not found:", emailId);
        return { skipped: true };
      }

      // Never resend a previously claimed email.
      if (email.status !== "scheduled") {
        console.log(
          "Email already handled:",
          emailId,
          email.status
        );
        return { skipped: true };
      }

      // For this first worker, require the sender to
      // match the configured Ethereal SMTP account.
      if (email.from_email !== username) {
        throw new Error(
          "Sender is not configured for Ethereal SMTP"
        );
      }

      // 2. Never send before the scheduled time.
      const scheduledTime =
        new Date(email.scheduled_at).getTime();

      if (scheduledTime > Date.now()) {
        if (!token) {
          throw new Error("Missing worker lock");
        }

        await job.moveToDelayed(scheduledTime, token);
        throw new DelayedError();
      }

      // 3. Reserve hourly quota and minimum delay.
      const permission = await reserveSendPermission(
        email.sender_id
      );

      if (!permission.allowed) {
        if (!token) {
          throw new Error("Missing worker lock");
        }

        const retryAt =
          Date.now() +
          Math.max(1000, permission.retryAfterMs) +
          250;

        await job.moveToDelayed(retryAt, token);

        console.log(
          "Email delayed:",
          emailId,
          permission.reason
        );

        throw new DelayedError();
      }

      // 4. Atomically claim the email.
      const claimed = await claimScheduledEmail(emailId);

      if (!claimed) {
        console.log("Email claim rejected:", emailId);
        return { skipped: true };
      }

      // 5. Send with Ethereal SMTP.
      try {
        const info = await transporter.sendMail({
          from: {
            name: email.display_name || "ReachInbox",
            address: email.from_email
          },
          to: claimed.recipient_email,
          subject: claimed.subject,
          text: claimed.body
        });

        if (!info.accepted?.length) {
          throw new Error("SMTP did not accept the recipient");
        }

        const previewUrl =
          nodemailer.getTestMessageUrl(info);

        // 6. Save the SMTP result.
        await pool.query(
          `UPDATE email_jobs
           SET
             status = 'sent',
             sent_at = NOW(),
             smtp_message_id = $2,
             smtp_preview_url = $3,
             updated_at = NOW()
           WHERE id = $1 AND status = 'processing'`,
          [
            emailId,
            info.messageId,
            typeof previewUrl === "string"
              ? previewUrl
              : null
          ]
        );

        console.log("Email accepted by Ethereal:", emailId);

        return {
          sent: true,
          messageId: info.messageId
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unknown SMTP error";

        // Do not automatically retry an uncertain
        // SMTP delivery: it may already have been accepted.
        await pool.query(
          `UPDATE email_jobs
           SET
             status = 'failed',
             last_error = $2,
             updated_at = NOW()
           WHERE id = $1 AND status = 'processing'`,
          [emailId, message.slice(0, 500)]
        );

        throw error;
      }
    },

    {
      connection: {
        host: process.env.REDIS_HOST ?? "127.0.0.1",
        port: Number(process.env.REDIS_PORT ?? 6379),
        maxRetriesPerRequest: null
      },
      concurrency
    }
  );

  worker.on("completed", (job, result) => {
    console.log("Job completed:", job.id);
    if (job.name === "send-email" && !result?.skipped &&
        typeof job.data?.emailJobId === "string") {
      void syncDeliveryOutcome(job.data.emailJobId).catch((error) => {
        console.error("Delivery integration error:", error);
      });
    }
  });

  worker.on("failed", (job, error) => {
    console.error("Job failed:", job?.id, error.message);
    if (job?.name === "send-email" &&
        typeof job.data?.emailJobId === "string") {
      void syncDeliveryOutcome(job.data.emailJobId).catch((syncError) => {
        console.error("Delivery integration error:", syncError);
      });
    }
  });

  worker.on("error", (error) => {
    console.error("Worker error:", error.message);
  });

  console.log("ReachInbox email worker started.");
  console.log("Concurrency:", concurrency);

  // Shut down safely when stopped.
  let stopping = false;

  async function shutdown() {
    if (stopping) return;
    stopping = true;

    console.log("Stopping email worker...");

    await worker.close();
    transporter.close();
    await closeSendPermission();
    await pool.end();

    console.log("Worker stopped.");
  }

  process.once("SIGINT", () => {
    void shutdown().catch(console.error);
  });

  process.once("SIGTERM", () => {
    void shutdown().catch(console.error);
  });
}

main().catch((error) => {
  console.error("Worker startup failed:", error);
  process.exitCode = 1;
});
