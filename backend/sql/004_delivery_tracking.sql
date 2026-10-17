-- Track email delivery attempts and SMTP responses.
-- This migration does not send any emails.

ALTER TABLE email_jobs
  ADD COLUMN IF NOT EXISTS send_attempts INTEGER
    NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),

  ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ,

  ADD COLUMN IF NOT EXISTS smtp_message_id TEXT,

  ADD COLUMN IF NOT EXISTS smtp_preview_url TEXT;

-- Help us identify interrupted processing jobs.
CREATE INDEX IF NOT EXISTS idx_email_jobs_processing
ON email_jobs(sending_started_at)
WHERE status = 'processing';
