CREATE TABLE IF NOT EXISTS slack_connections (
    user_id UUID PRIMARY KEY
        REFERENCES users(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL,
    team_name TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    webhook_enc TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
