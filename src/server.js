import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { CIPHER, DEFAULT_DESCRIPTOR_PORT, DEFAULT_GRPC_PORT, DEFAULT_RECEIVE_DIR, defaultDeviceName, nowMs } from "./config.js";
import { createEphemeralKeyPair, createSha256, decryptChunk, deriveSessionKey, encryptChunk } from "./crypto.js";
import { grpc, loadTransferProto } from "./proto.js";
import { startDescriptorServer, startSsdpResponder } from "./discovery.js";

const SESSION_TTL_MS = 15 * 60 * 1000;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readIndex(receiveDir) {
  const indexPath = path.join(receiveDir, "index.json");
  if (!fs.existsSync(indexPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(indexPath, "utf8"));
}

function writeIndex(receiveDir, entries) {
  fs.writeFileSync(path.join(receiveDir, "index.json"), JSON.stringify(entries, null, 2));
}

function safeFileName(fileName) {
  return path.basename(fileName || "unnamed.bin").replace(/[^\w.()[\] -]/g, "_");
}

export async function startServer(options = {}) {
  const grpcPort = Number(options.grpcPort ?? DEFAULT_GRPC_PORT);
  const descriptorPort = Number(options.descriptorPort ?? DEFAULT_DESCRIPTOR_PORT);
  const receiveDir = path.resolve(options.receiveDir ?? DEFAULT_RECEIVE_DIR);
  const deviceId = options.deviceId ?? randomUUID();
  const deviceName = options.name ?? defaultDeviceName();
  const sessions = new Map();

  ensureDir(receiveDir);
  ensureDir(path.join(receiveDir, ".incoming"));

  const proto = loadTransferProto();
  const server = new grpc.Server();

  function requireSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt < nowMs()) {
      throw new Error("세션이 없거나 만료되었습니다.");
    }
    return session;
  }

  server.addService(proto.TransferService.service, {
    ping(call, callback) {
      callback(null, {
        serverDeviceId: deviceId,
        serverName: deviceName,
        unixTimeMs: String(nowMs())
      });
    },

    handshake(call, callback) {
      try {
        const keyPair = createEphemeralKeyPair();
        const sessionKey = deriveSessionKey(keyPair.privateKey, call.request.clientPublicKey);
        const sessionId = randomUUID();
        const expiresAt = nowMs() + SESSION_TTL_MS;
        sessions.set(sessionId, {
          key: sessionKey,
          clientDeviceId: call.request.clientDeviceId,
          expiresAt
        });
        callback(null, {
          sessionId,
          serverDeviceId: deviceId,
          serverName: deviceName,
          serverPublicKey: keyPair.publicKeyDer,
          selectedCipher: CIPHER,
          expiresAtUnixTimeMs: String(expiresAt)
        });
      } catch (error) {
        callback(error);
      }
    },

    listFiles(call, callback) {
      try {
        requireSession(call.request.sessionId);
        callback(null, { files: readIndex(receiveDir) });
      } catch (error) {
        callback(error);
      }
    },

    sendFile(call, callback) {
      let transferId = "";
      let fileName = "";
      let tempPath = "";
      let size = 0;
      let session;
      const hash = createSha256();

      call.on("data", (chunk) => {
        try {
          session ??= requireSession(chunk.sessionId);
          transferId ||= chunk.transferId || randomUUID();
          fileName ||= safeFileName(chunk.fileName);
          tempPath ||= path.join(receiveDir, ".incoming", `${transferId}.part`);

          const plain = chunk.encrypted
            ? decryptChunk(session.key, { nonce: chunk.nonce, data: chunk.data, authTag: chunk.authTag })
            : Buffer.from(chunk.data);

          fs.appendFileSync(tempPath, plain);
          hash.update(plain);
          size += plain.length;
        } catch (error) {
          call.destroy(error);
        }
      });

      call.on("end", () => {
        try {
          if (!tempPath || !fileName) {
            throw new Error("파일 chunk를 받지 못했습니다.");
          }
          const fileId = randomUUID();
          const finalName = `${Date.now()}-${fileId}-${fileName}`;
          const finalPath = path.join(receiveDir, finalName);
          fs.renameSync(tempPath, finalPath);
          const sha256Hex = hash.digest("hex");
          const entries = readIndex(receiveDir);
          const entry = {
            fileId,
            fileName,
            size: String(size),
            sha256Hex,
            receivedAtUnixTimeMs: String(nowMs()),
            storedName: finalName
          };
          entries.unshift(entry);
          writeIndex(receiveDir, entries);
          callback(null, {
            transferId,
            fileId,
            fileName,
            size: String(size),
            sha256Hex,
            stored: true
          });
        } catch (error) {
          callback(error);
        }
      });
    },

    receiveFile(call) {
      try {
        const session = requireSession(call.request.sessionId);
        const entry = readIndex(receiveDir).find((item) => item.fileId === call.request.fileId);
        if (!entry) {
          call.destroy(new Error("요청한 파일을 찾을 수 없습니다."));
          return;
        }

        const filePath = path.join(receiveDir, entry.storedName);
        const totalSize = fs.statSync(filePath).size;
        let offset = 0;
        const stream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });

        stream.on("data", (plain) => {
          const encrypted = encryptChunk(session.key, plain);
          call.write({
            sessionId: call.request.sessionId,
            transferId: entry.fileId,
            fileName: entry.fileName,
            totalSize: String(totalSize),
            offset: String(offset),
            nonce: encrypted.nonce,
            data: encrypted.data,
            authTag: encrypted.authTag,
            encrypted: true,
            sha256Hex: entry.sha256Hex
          });
          offset += plain.length;
        });
        stream.on("end", () => call.end());
        stream.on("error", (error) => call.destroy(error));
      } catch (error) {
        call.destroy(error);
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${grpcPort}`, grpc.ServerCredentials.createInsecure(), (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const descriptor = await startDescriptorServer({ deviceId, deviceName, grpcPort, descriptorPort });
  const ssdp = await startSsdpResponder({ deviceId, location: descriptor.location });

  return {
    deviceId,
    deviceName,
    grpcPort,
    descriptorPort,
    receiveDir,
    descriptorUrl: descriptor.location,
    close: async () => {
      ssdp.close();
      descriptor.server.close();
      await new Promise((resolve) => server.tryShutdown(resolve));
    }
  };
}
