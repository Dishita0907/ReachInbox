import "dotenv/config";

import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";

import { emailQueue } from "./emailQueue.js";

const PORT = 4001;
const BASE_PATH = "/admin/queues";

const serverAdapter = new ExpressAdapter();

serverAdapter.setBasePath(BASE_PATH);

// Connect our existing email queue to Bull Board.
// Read-only mode prevents accidental retries or deletions.
createBullBoard({
  queues: [
    new BullMQAdapter(emailQueue, {
      readOnlyMode: true
    })
  ],
  serverAdapter
});

const app = express();

app.use(BASE_PATH, serverAdapter.getRouter());

// Listen only on this Mac, not the public network.
const server = app.listen(
  PORT,
  "127.0.0.1",
  () => {
    console.log("Bull Board started successfully!");
    console.log(
      `Dashboard: http://localhost:${PORT}${BASE_PATH}`
    );
    console.log("Mode: READ ONLY");
  }
);

process.once("SIGINT", () => {
  console.log("Stopping Bull Board...");

  server.close(() => {
    void emailQueue.close().then(() => {
      console.log("Bull Board stopped.");
    });
  });
});
