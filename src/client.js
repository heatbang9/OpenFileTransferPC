import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CIPHER, DEFAULT_CHUNK_SIZE, defaultDeviceName } from "./config.js";
import { createEphemeralKeyPair, createSha256, decryptChunk, deriveSessionKey, encryptChunk } from "./crypto.js";
import { createClient } from "./proto.js";

function unary(method, request) {
  return new Promise((resolve, reject) => {
    method(request, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

export async function handshake(address, options = {}) {
  const client = createClient(address);
  const keyPair = createEphemeralKeyPair();
  const response = await unary(client.handshake.bind(client), {
    clientDeviceId: options.deviceId ?? randomUUID(),
    clientName: options.name ?? defaultDeviceName(),
    clientPublicKey: keyPair.publicKeyDer,
    supportedCiphers: [CIPHER]
  });

  return {
    client,
    sessionId: response.sessionId,
    sessionKey: deriveSessionKey(keyPair.privateKey, response.serverPublicKey),
    server: response
  };
}

export async function ping(address) {
  const client = createClient(address);
  return unary(client.ping.bind(client), {
    clientDeviceId: randomUUID()
  });
}

export async function listFiles(address) {
  const session = await handshake(address);
  return unary(session.client.listFiles.bind(session.client), {
    sessionId: session.sessionId
  });
}

export async function sendFile(address, filePath, options = {}) {
  const absolutePath = path.resolve(filePath);
  const stat = fs.statSync(absolutePath);
  const fileName = options.fileName ?? path.basename(absolutePath);
  const transferId = randomUUID();
  const session = await handshake(address, options);
  const hash = createSha256();

  return new Promise((resolve, reject) => {
    const call = session.client.sendFile((error, receipt) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(receipt);
    });

    const stream = fs.createReadStream(absolutePath, { highWaterMark: DEFAULT_CHUNK_SIZE });
    let offset = 0;

    stream.on("data", (plain) => {
      hash.update(plain);
      const encrypted = encryptChunk(session.sessionKey, plain);
      call.write({
        sessionId: session.sessionId,
        transferId,
        fileName,
        totalSize: String(stat.size),
        offset: String(offset),
        nonce: encrypted.nonce,
        data: encrypted.data,
        authTag: encrypted.authTag,
        encrypted: true,
        sha256Hex: ""
      });
      offset += plain.length;
    });
    stream.on("end", () => {
      call.end();
    });
    stream.on("error", (error) => {
      call.destroy(error);
      reject(error);
    });
  });
}

export async function receiveFile(address, fileId, outDir = ".") {
  const session = await handshake(address);
  fs.mkdirSync(outDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const call = session.client.receiveFile({
      sessionId: session.sessionId,
      fileId
    });
    const hash = createSha256();
    let fileName = "";
    let outputPath = "";
    let size = 0;

    call.on("data", (chunk) => {
      try {
        fileName ||= path.basename(chunk.fileName || `${fileId}.bin`);
        outputPath ||= path.join(outDir, fileName);
        const plain = chunk.encrypted
          ? decryptChunk(session.sessionKey, { nonce: chunk.nonce, data: chunk.data, authTag: chunk.authTag })
          : Buffer.from(chunk.data);
        fs.appendFileSync(outputPath, plain);
        hash.update(plain);
        size += plain.length;
      } catch (error) {
        call.destroy(error);
      }
    });
    call.on("end", () => {
      resolve({
        fileId,
        fileName,
        outputPath,
        size,
        sha256Hex: hash.digest("hex")
      });
    });
    call.on("error", reject);
  });
}
