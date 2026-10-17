import "dotenv/config";
import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
  maxRetriesPerRequest: null
});

// Check quota and delay together inside one Redis operation.
const RESERVE_SCRIPT = `
  local time = redis.call("TIME")
  local now = tonumber(time[1]) * 1000
    + math.floor(tonumber(time[2]) / 1000)

  local hourlyLimit = tonumber(ARGV[1])
  local minimumDelay = tonumber(ARGV[2])

  local hourIndex = math.floor(now / 3600000)
  local nextHour = (hourIndex + 1) * 3600000

  local hourKey = KEYS[1] .. ":" .. hourIndex
  local delayKey = KEYS[2]

  local used = tonumber(
    redis.call("GET", hourKey) or "0"
  )

  -- First check the hourly sending limit.
  if used >= hourlyLimit then
    return {"hourly_limit", nextHour - now, used}
  end

  -- Then check the minimum sending interval.
  local previous = tonumber(
    redis.call("GET", delayKey) or "-1"
  )

  if previous >= 0 and now < previous + minimumDelay then
    return {
      "minimum_delay",
      previous + minimumDelay - now,
      used
    }
  end

  -- Both checks passed.
  -- Reserve both permissions atomically.
  local newCount = redis.call("INCR", hourKey)

  if newCount == 1 then
    redis.call(
      "PEXPIREAT",
      hourKey,
      nextHour + 3600000
    )
  end

  redis.call(
    "SET",
    delayKey,
    now,
    "PX",
    math.max(60000, minimumDelay * 2)
  )

  return {"allowed", 0, newCount}
`;

export type PermissionReason =
  | "allowed"
  | "hourly_limit"
  | "minimum_delay";

export interface SendPermission {
  allowed: boolean;
  reason: PermissionReason;
  retryAfterMs: number;
  used: number;
}

export interface PermissionOptions {
  hourlyLimit?: number;
  minimumDelayMs?: number;
}

export async function reserveSendPermission(
  senderId: string,
  options: PermissionOptions = {}
): Promise<SendPermission> {
  const hourlyLimit = options.hourlyLimit ??
    Number(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER);

  const minimumDelayMs = options.minimumDelayMs ??
    Number(process.env.MIN_SEND_DELAY_MS);

  if (
    !senderId ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(senderId) ||
    !Number.isInteger(hourlyLimit) ||
    hourlyLimit < 1 ||
    !Number.isInteger(minimumDelayMs) ||
    minimumDelayMs < 1 ||
    minimumDelayMs > 3600000
  ) {
    throw new Error("Invalid sending permission configuration");
  }

  const result = await redis.eval(
    RESERVE_SCRIPT,
    2,
    `reachinbox:gate:hourly:${senderId}`,
    `reachinbox:gate:delay:${senderId}`,
    String(hourlyLimit),
    String(minimumDelayMs)
  );

  if (!Array.isArray(result) || result.length !== 3) {
    throw new Error("Unexpected Redis permission response");
  }

  const reason = String(result[0]) as PermissionReason;

  if (
    reason !== "allowed" &&
    reason !== "hourly_limit" &&
    reason !== "minimum_delay"
  ) {
    throw new Error("Unknown Redis permission decision");
  }

  return {
    allowed: reason === "allowed",
    reason,
    retryAfterMs: Number(result[1]),
    used: Number(result[2])
  };
}

export async function closeSendPermission() {
  await redis.quit();
}
