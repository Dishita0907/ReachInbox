import { Router } from "express";
import { pool } from "./db.js";

export const senderRouter = Router();

senderRouter.get("/senders", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    res.status(401).json({ status: "error", message: "Please sign in first" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, from_email, display_name
       FROM sender_accounts
       WHERE user_id = $1
       ORDER BY display_name ASC NULLS LAST, from_email ASC`,
      [userId]
    );
    res.json({ status: "ok", senders: result.rows });
  } catch (error) {
    console.error("Loading senders failed", error);
    res.status(503).json({ status: "error", message: "Cannot load sender accounts" });
  }
});
