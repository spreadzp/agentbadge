import { generateKeyPairSync } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export interface SigningKey {
  keyId: string;
  algorithm: "ed25519";
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface PublicKeyEntry {
  keyId: string;
  algorithm: "ed25519";
  publicKey: Uint8Array;
}

export function generateSigningKey(keyId: string): SigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "der", type: "pkcs8" },
    publicKeyEncoding: { format: "der", type: "spki" },
  });
  return {
    keyId,
    algorithm: "ed25519",
    privateKey: extractRawKey(privateKey),
    publicKey: extractRawKey(publicKey),
  };
}

export async function saveSigningKey(key: SigningKey, path: string): Promise<void> {
  const payload = {
    keyId: key.keyId,
    algorithm: key.algorithm,
    privateKey: Buffer.from(key.privateKey).toString("base64"),
    publicKey: Buffer.from(key.publicKey).toString("base64"),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

export async function loadSigningKey(path: string): Promise<SigningKey> {
  const content = await readFile(path, "utf8");
  const payload = JSON.parse(content);
  return {
    keyId: payload.keyId,
    algorithm: payload.algorithm,
    privateKey: new Uint8Array(Buffer.from(payload.privateKey, "base64")),
    publicKey: new Uint8Array(Buffer.from(payload.publicKey, "base64")),
  };
}

export async function savePublicKey(key: SigningKey, path: string): Promise<void> {
  const payload = {
    keyId: key.keyId,
    algorithm: key.algorithm,
    publicKey: Buffer.from(key.publicKey).toString("base64"),
  };
  await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
}

export async function loadPublicKey(path: string): Promise<PublicKeyEntry> {
  const content = await readFile(path, "utf8");
  const payload = JSON.parse(content);
  return {
    keyId: payload.keyId,
    algorithm: payload.algorithm,
    publicKey: new Uint8Array(Buffer.from(payload.publicKey, "base64")),
  };
}

function extractRawKey(derEncoded: Buffer): Uint8Array {
  // Ed25519 PKCS8 private key: last 32 bytes contain the raw seed
  // Ed25519 SPKI public key: last 32 bytes contain the raw public key
  return new Uint8Array(derEncoded.subarray(derEncoded.length - 32));
}
