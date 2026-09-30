import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { MeldError } from "./errors";

export interface EncryptedValue {
  version: number;
  algorithm: "aes-256-gcm";
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function parseEncryptionKey(value: string): Buffer {
  const key = /^[a-f\d]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new MeldError({
      code: "CONFIGURATION_REQUIRED",
      message: "CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    });
  }
  return key;
}

export function encryptSecret(plaintext: string, keyValue: string, version = 1): EncryptedValue {
  const key = parseEncryptionKey(keyValue);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    version,
    algorithm: "aes-256-gcm",
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(value: EncryptedValue, keyValue: string): string {
  if (value.algorithm !== "aes-256-gcm") {
    throw new MeldError({ code: "INVALID_INPUT", message: "Unsupported encrypted credential format." });
  }

  try {
    const decipher = createDecipheriv("aes-256-gcm", parseEncryptionKey(keyValue), Buffer.from(value.iv, "base64"));
    decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new MeldError({
      code: "FORBIDDEN",
      message: "The credential could not be decrypted with the active key version.",
    });
  }
}
