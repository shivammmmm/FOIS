import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
let client;
let connecting;

async function getClient() {
  if (client?.isReady) return client;
  if (connecting) return connecting;

  client = createClient({ url: REDIS_URL, socket: { reconnectStrategy: false } });
  client.on("error", (error) => console.warn(`[redis] ${error.message}`));
  connecting = client.connect()
    .then(() => client)
    .catch(() => null)
    .finally(() => { connecting = null; });
  return connecting;
}

export async function cachedJson(key, ttlSeconds, loader) {
  const redis = await getClient();
  if (redis) {
    const hit = await redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit);
  }

  const value = await loader();
  if (redis) await redis.set(key, JSON.stringify(value), { EX: ttlSeconds }).catch(() => undefined);
  return value;
}

export async function invalidateCachePrefix(prefix) {
  const redis = await getClient();
  if (!redis) return;
  for await (const keys of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
    if (keys.length) await redis.del(keys);
  }
}
