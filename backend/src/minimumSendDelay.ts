import "dotenv/config";
import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null
});

// This runs atomically inside Redis.
// Only one worker can reserve the next sending slot.
const RESERVE_DELAY_SCRIPT = `
  local time = redis.call("TIME")
  local now = tonumber(time[1]) * 1000
    + math.floor(tonumber(time[2]) / 1000)

  local gap = tonumber(ARGV[1])
  local previous = tonumber(redis.call("GET", KEYS[1]) or "-1")

  if previous >= 0 and now < previous + gap then
    return {0, previous + gap, now}
  end

  redis.call(
    "SET",
    KEYS[1],
    now,
    "PX",
    math.max(60000, gap * 3)
  )

  return {1, now, now}
`;

export function getMinimumSendDelay(): number {
  const value = Number(process.env.MIN_SEND_DELAY_MS);

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > 3600000
  ) {
    throw new Error(
      "MIN_SEND_DELAY_MS must be between 1 and 3600000"
    );
  }

  return value;
}

export interface SendDelayResult {
  allowed: boolean;
  waitMs: number;
  retryAt: string;
}

export async function reserveSendStart(
  senderId: string,
  minimumDelayMs = getMinimumSendDelay()
): Promise<SendDelayResult> {
  if (
    !senderId ||
    !Number.isInteger(minimumDelayMs) ||
    minimumDelayMs < 1 ||
    minimumDelayMs > 3600000
  ) {
    throw new Error("Invalid sender or sending delay");
  }

  const result = await redis.eval(
    RESERVE_DELAY_SCRIPT,
    1,
    `reachinbox:send-delay:${senderId}`,
    String(minimumDelayMs)
  );

  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Unexpected Redis delay response");
  }

  const allowed = Number(result[0]) === 1;
  const retryTime = Number(result[1]);
  const currentTime = Number(result[2]);

  return {
    allowed,
    waitMs: allowed ? 0 : Math.max(0, retryTime - currentTime),
    retryAt: new Date(retryTime).toISOString()
  };
}

export async function closeSendDelayConnection() {
  await redis.quit();
}
