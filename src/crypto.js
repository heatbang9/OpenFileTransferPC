import crypto from "node:crypto";

const HKDF_SALT = Buffer.from("openfiletransfer-v1-session", "utf8");
const HKDF_INFO = Buffer.from("openfiletransfer-file-payload", "utf8");

export function createEphemeralKeyPair() {
  const pair = crypto.generateKeyPairSync("x25519");
  return {
    privateKey: pair.privateKey,
    publicKeyDer: pair.publicKey.export({ type: "spki", format: "der" })
  };
}

export function deriveSessionKey(privateKey, peerPublicKeyDer) {
  const peerPublicKey = crypto.createPublicKey({
    key: Buffer.from(peerPublicKeyDer),
    format: "der",
    type: "spki"
  });
  const secret = crypto.diffieHellman({ privateKey, publicKey: peerPublicKey });
  return Buffer.from(crypto.hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
}

export function encryptChunk(sessionKey, plain) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey, nonce);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { nonce, data, authTag };
}

export function decryptChunk(sessionKey, encrypted) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey, Buffer.from(encrypted.nonce));
  decipher.setAuthTag(Buffer.from(encrypted.authTag));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.data)), decipher.final()]);
}

export function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function createSha256() {
  return crypto.createHash("sha256");
}

