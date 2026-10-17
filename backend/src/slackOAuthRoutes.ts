import "dotenv/config";

import { Router } from "express";
import {
  randomBytes,
  createCipheriv,
  timingSafeEqual
} from "node:crypto";
import { pool } from "./db.js";

export const slackOAuthRouter = Router();

const REDIRECT_URI =
  process.env.SLACK_REDIRECT_URI ??
  "http://localhost:4000/auth/slack/callback";

type OAuthState = {
  state: string;
  userId: string;
  expiresAt: number;
};

type SessionData = {
  userId?: string;
  slackOAuth?: OAuthState;
  save: (callback: (error?: Error) => void) => void;
};

type SlackResponse = {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  incoming_webhook?: {
    url: string;
    channel: string;
    channel_id: string;
  };
};

function encrypt(value: string): string {
  const hex = process.env.SLACK_ENCRYPTION_KEY ?? "";

  if (!/^[a-fA-F0-9]{64}$/.test(hex)) {
    throw new Error("Slack encryption key is invalid");
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(hex, "hex"),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final()
  ]);

  return [
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex")
  ].join(":");
}

// 1. Start Slack authorization.
slackOAuthRouter.get("/start", (req, res) => {
  const session = req.session as SessionData;

  if (!session.userId) {
    res.status(401).send("Please sign in with Google first.");
    return;
  }

  if (
    !process.env.SLACK_CLIENT_ID ||
    !process.env.SLACK_CLIENT_SECRET
  ) {
    res.status(500).send("Slack credentials are missing.");
    return;
  }

  const state = randomBytes(32).toString("hex");

  session.slackOAuth = {
    state,
    userId: session.userId,
    expiresAt: Date.now() + 10 * 60 * 1000
  };

  const url = new URL(
    "https://slack.com/oauth/v2/authorize"
  );

  url.searchParams.set(
    "client_id",
    process.env.SLACK_CLIENT_ID
  );
  url.searchParams.set(
    "scope",
    "chat:write,incoming-webhook"
  );
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", state);

  session.save((error) => {
    if (error) {
      res.status(500).send("Could not save OAuth session.");
      return;
    }

    res.redirect(url.toString());
  });
});

// 2. Handle Slack's OAuth callback.
slackOAuthRouter.get("/callback", async (req, res) => {
  const session = req.session as SessionData;

  try {
    const code = req.query.code;
    const receivedState = req.query.state;
    const saved = session.slackOAuth;

    if (
      !saved ||
      !session.userId ||
      saved.userId !== session.userId ||
      Date.now() > saved.expiresAt ||
      typeof receivedState !== "string" ||
      !/^[a-f0-9]{64}$/.test(receivedState) ||
      !timingSafeEqual(
        Buffer.from(receivedState, "hex"),
        Buffer.from(saved.state, "hex")
      )
    ) {
      res.status(403).send(
        "Slack authorization expired or invalid. Start again."
      );
      return;
    }

    // State can only be used once.
    delete session.slackOAuth;

    await new Promise<void>((resolve, reject) => {
      session.save((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    if (typeof code !== "string" || !code) {
      res.status(400).send(
        "Slack authorization was cancelled or failed."
      );
      return;
    }

    const credentials = Buffer.from(
      `${process.env.SLACK_CLIENT_ID}:${process.env.SLACK_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(
      "https://slack.com/api/oauth.v2.access",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type":
            "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          code,
          redirect_uri: REDIRECT_URI
        }),
        signal: AbortSignal.timeout(15000)
      }
    );

    if (!response.ok) {
      throw new Error("Slack token exchange HTTP error");
    }

    const data =
      (await response.json()) as SlackResponse;

    if (
      !data.ok ||
      !data.team?.id ||
      !data.incoming_webhook?.url ||
      !data.incoming_webhook.channel_id
    ) {
      console.error(
        "Slack OAuth response error:",
        data.error ?? "Missing installation details"
      );

      res.status(400).send(
        "Slack authorization failed. Check app permissions."
      );
      return;
    }

    const hook = data.incoming_webhook;
    const hookUrl = new URL(hook.url);

    if (
      hookUrl.protocol !== "https:" ||
      hookUrl.hostname !== "hooks.slack.com" ||
      !hookUrl.pathname.startsWith("/services/")
    ) {
      throw new Error("Invalid Slack webhook destination");
    }

    // Store the webhook encrypted, never as plain text.
    await pool.query(
      `INSERT INTO slack_connections
        (user_id, team_id, team_name, channel_id,
         channel_name, webhook_enc)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id)
       DO UPDATE SET
         team_id = EXCLUDED.team_id,
         team_name = EXCLUDED.team_name,
         channel_id = EXCLUDED.channel_id,
         channel_name = EXCLUDED.channel_name,
         webhook_enc = EXCLUDED.webhook_enc,
         connected_at = NOW()`,
      [
        session.userId,
        data.team.id,
        data.team.name,
        hook.channel_id,
        hook.channel,
        encrypt(hook.url)
      ]
    );

    console.log("Slack workspace connected successfully.");

    // 3. Send one real test notification.
    const testResponse = await fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text:
          "✅ ReachInbox Scheduler connected successfully! " +
          "This is a real Slack notification test."
      }),
      signal: AbortSignal.timeout(15000)
    });

    const result = await testResponse.text();

    if (!testResponse.ok || result.trim() !== "ok") {
      res.status(502).type("text/plain").send(
        "Slack connected, but the test notification failed. " +
        "Do not reinstall yet."
      );
      return;
    }

    console.log("Slack test notification delivered.");

    res.status(200).type("text/plain").send(
      "SUCCESS: Slack connected!\n" +
      "Workspace: " + data.team.name + "\n" +
      "Channel: " + hook.channel + "\n" +
      "Test notification posted successfully."
    );

  } catch (error) {
    console.error(
      "Slack connection failed:",
      error instanceof Error ? error.message : "Unknown error"
    );

    res.status(500).type("text/plain").send(
      "Slack connection failed. Check the backend terminal."
    );
  }
});

// Check connected workspace without exposing credentials.
slackOAuthRouter.get("/status", async (req, res) => {
  const session = req.session as SessionData;

  if (!session.userId) {
    res.status(401).json({
      connected: false,
      message: "Please sign in first"
    });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT team_name, channel_name, connected_at
       FROM slack_connections
       WHERE user_id = $1`,
      [session.userId]
    );

    res.json({
      connected: result.rowCount === 1,
      workspace: result.rows[0]?.team_name ?? null,
      channel: result.rows[0]?.channel_name ?? null
    });
  } catch {
    res.status(503).json({
      connected: false,
      message: "Unable to check Slack connection"
    });
  }
});
