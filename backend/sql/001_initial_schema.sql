-- TABLE 1: Google-authenticated users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- TABLE 2: Email sender accounts
CREATE TABLE IF NOT EXISTS sender_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    from_email TEXT NOT NULL,
    display_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (user_id, from_email),
    UNIQUE (id, user_id)
);

-- TABLE 3: Scheduled email jobs
CREATE TABLE IF NOT EXISTS email_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    sender_id UUID NOT NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,

    status TEXT NOT NULL DEFAULT 'scheduled'
        CHECK (status IN (
            'scheduled',
            'processing',
            'sent',
            'failed'
        )),

    sent_at TIMESTAMPTZ,
    last_error TEXT,
    idempotency_key TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (sender_id, user_id)
        REFERENCES sender_accounts(id, user_id),

    UNIQUE (user_id, idempotency_key)
);

-- Make scheduled email lookups faster
CREATE INDEX IF NOT EXISTS idx_email_jobs_status_time
ON email_jobs(status, scheduled_at);

-- Make user dashboard queries faster
CREATE INDEX IF NOT EXISTS idx_email_jobs_user_status
ON email_jobs(user_id, status);
