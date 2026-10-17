-- Track which terminal delivery status was notified, without storing secrets.
ALTER TABLE email_jobs
ADD COLUMN IF NOT EXISTS slack_notified_status TEXT;
