import "dotenv/config";
import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null
});

// Redis performs this whole operation atomically.
const RESERVE_SLOT_SCRIPT = `
  local now = tonumber(redis.call("TIME")[1])
  local hourIndex = math.floor(now / 3600)

  local key = KEYS[1] .. ":" .. hourIndex
  local limit = tonumber(ARGV[1])

  local used = tonumber(redis.call("GET", key) or "0")
  local nextHour = (hourIndex + 1) * 3600

  if used >= limit then
    return {0, used, nextHour * 1000}
  end

  used = redis.call("INCR", key)

  if used == 1 then
    redis.call(
      "EXPIREAT",
      key,
      (hourIndex + 2) * 3600
    )
  end

  return {1, used, nextHour * 1000}
`;

export interface HourlySlotResult {
  allowed: boolean;
  used: number;
  limit: number;
  nextHourAt: string;
}

// Read the configurable per-sender hourly limit
export function getConfiguredHourlyLimit(): number {
  const value = Number(
    process.env.MAX_EMAILS_PER_HOUR_PER_SENDER
  );

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      "MAX_EMAILS_PER_HOUR_PER_SENDER must be a positive integer"
    );
  }

  return value;
}

// Reserve one hourly sending slot for a sender
export async function reserveHourlySlot(
  senderId: string,
  limit = getConfiguredHourlyLimit()
): Promise<HourlySlotResult> {
  if (!senderId || !Number.isInteger(limit) || limit < 1) {
    throw new Error("Invalid sender ID or hourly limit");
  }

  const result = await redis.eval(
    RESERVE_SLOT_SCRIPT,
    1,
    `reachinbox:hourly:${senderId}`,
    String(limit)
  );

  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Unexpected Redis rate-limit response");
  }

  return {
    allowed: Number(result[0]) === 1,
    used: Number(result[1]),
    limit,
    nextHourAt: new Date(Number(result[2])).toISOString()
  };
}

export async function closeHourlyRateLimiter() {
  await redis.quit();
}
