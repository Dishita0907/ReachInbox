import "dotenv/config";
import { pool } from "./db.js";

async function main() {
  try {
    const etherealEmail = process.env.ETHEREAL_USER;

    if (
      !etherealEmail ||
      !etherealEmail.endsWith("@ethereal.email")
    ) {
      throw new Error("Valid Ethereal email not configured");
    }

    // Find the authenticated development user
    const users = await pool.query(
      "SELECT id FROM users LIMIT 2"
    );

    if (users.rows.length !== 1) {
      throw new Error(
        "Expected exactly one development user"
      );
    }

    const userId = users.rows[0].id;

    // Register the Ethereal sender
    const result = await pool.query(
      `INSERT INTO sender_accounts (
         user_id,
         from_email,
         display_name
       )
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, from_email)
       DO UPDATE SET
         display_name = EXCLUDED.display_name
       RETURNING id`,
      [
        userId,
        etherealEmail,
        "ReachInbox Ethereal Sender"
      ]
    );

    console.log("Ethereal sender registered successfully!");
    console.log("Sender ID:", result.rows[0].id);
    console.log("No email was sent.");
  } catch (error) {
    console.error("Sender registration failed:", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
