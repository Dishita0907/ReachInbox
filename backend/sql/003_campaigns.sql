-- Store email campaign settings
CREATE TABLE IF NOT EXISTS email_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id),

    sender_id UUID NOT NULL,

    subject TEXT NOT NULL,
    body TEXT NOT NULL,

    start_at TIMESTAMPTZ NOT NULL,

    delay_seconds INTEGER NOT NULL DEFAULT 2
        CHECK (delay_seconds >= 1),

    hourly_limit INTEGER NOT NULL DEFAULT 50
        CHECK (hourly_limit > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (sender_id, user_id)
        REFERENCES sender_accounts(id, user_id)
);

-- Connect individual emails to campaigns
ALTER TABLE email_jobs
ADD COLUMN IF NOT EXISTS campaign_id UUID
REFERENCES email_campaigns(id);

-- Speed up campaign email lookups
CREATE INDEX IF NOT EXISTS idx_email_jobs_campaign
ON email_jobs(campaign_id);
