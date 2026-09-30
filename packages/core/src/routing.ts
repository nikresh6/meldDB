import { createHash } from "node:crypto";
import { MeldError } from "./errors";

export type RoutingKey = string | number | bigint | boolean;

export function canonicalRoutingKey(value: RoutingKey): string {
  if (typeof value === "string") return `s:${Buffer.byteLength(value, "utf8")}:${value}`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new MeldError({ code: "INVALID_INPUT", message: "Routing keys must be finite numbers." });
    return `n:${Object.is(value, -0) ? "0" : value.toString()}`;
  }
  if (typeof value === "bigint") return `i:${value.toString()}`;
  return `b:${value ? "1" : "0"}`;
}

export function stableRoutingHash(value: RoutingKey): bigint {
  const digest = createHash("sha256").update(canonicalRoutingKey(value), "utf8").digest();
  return digest.readBigUInt64BE(0);
}

export function routeToShard(value: RoutingKey, shardIds: readonly string[]): string {
  if (shardIds.length === 0) {
    throw new MeldError({ code: "INVALID_INPUT", message: "No healthy shard is available for this table." });
  }

  const ordered = [...shardIds].sort((a, b) => a.localeCompare(b));
  const index = Number(stableRoutingHash(value) % BigInt(ordered.length));
  const shardId = ordered[index];
  if (!shardId) throw new MeldError({ code: "INVALID_INPUT", message: "Unable to resolve a shard." });
  return shardId;
}
