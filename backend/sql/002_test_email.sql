-- Development-only database test.
-- These records do not represent real Google accounts.

-- 1. Create a test user
INSERT INTO users (
    id,
    google_sub,
    email,
    display_name
)
VALUES (
    '11111111-1111-4111-8111-111111111111',
    'development-test-user',
    'testuser@example.test',
    'Test User'
)
ON CONFLICT DO NOTHING;

-- 2. Create a sender for that user
INSERT INTO sender_accounts (
    id,
    user_id,
    from_email,
    display_name
)
VALUES (
    '22222222-2222-4222-8222-222222222222',
    '11111111-1111-4111-8111-111111111111',
    'sender@example.test',
    'Test Sender'
)
ON CONFLICT DO NOTHING;

-- 3. Create a sample scheduled email
INSERT INTO email_jobs (
    id,
    user_id,
    sender_id,
    recipient_email,
    subject,
    body,
    scheduled_at,
    status,
    idempotency_key
)
VALUES (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'recipient@example.test',
    'ReachInbox Test Email',
    'Hello! This is a test email stored in PostgreSQL.',
    NOW() + INTERVAL '1 day',
    'scheduled',
    'dev-phase3e-test'
)
ON CONFLICT DO NOTHING;
