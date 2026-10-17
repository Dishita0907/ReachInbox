import "dotenv/config";
import { Queue } from "bullmq";

// Redis connection settings
const REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

// Create the email queue
export const emailQueue = new Queue("reachinbox-emails", {
  connection: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null
  }
});
