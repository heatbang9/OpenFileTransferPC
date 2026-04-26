import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
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

function publicFileEntry(entry) {
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    size: entry.size,
    sha256Hex: entry.sha256Hex,
    receivedAtUnixTimeMs: entry.receivedAtUnixTimeMs
  };
}

export async function startServer(options = {}) {
  const grpcPort = Number(options.grpcPort ?? DEFAULT_GRPC_PORT);
  const descriptorPort = Number(options.descriptorPort ?? DEFAULT_DESCRIPTOR_PORT);
  const receiveDir = path.resolve(options.receiveDir ?? DEFAULT_RECEIVE_DIR);
  const deviceId = options.deviceId ?? randomUUID();
  const deviceName = options.name ?? defaultDeviceName();
  const sessions = new Map();
  const eventStreams = new Map();
  const localEvents = new EventEmitter();

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

  function clientInfo(sessionId, session) {
    return {
      sessionId,
      clientDeviceId: session.clientDeviceId,
      clientName: session.clientName,
      connectedAtUnixTimeMs: String(session.connectedAt),
      lastSeenUnixTimeMs: String(session.lastSeen),
      eventStreamOpen: eventStreams.has(sessionId)
    };
  }

  function connectedClients() {
    const currentTime = nowMs();
    return [...sessions.entries()]
      .filter(([, session]) => session.expiresAt >= currentTime)
      .map(([sessionId, session]) => clientInfo(sessionId, session));
  }

  function publishEvent(type, message, extra = {}) {
    const event = {
      eventId: randomUUID(),
      type,
      unixTimeMs: String(nowMs()),
      message,
      sessionId: extra.sessionId ?? "",
      peerDeviceId: extra.peerDeviceId ?? "",
      peerName: extra.peerName ?? "",
      file: extra.file ?? null
    };
    localEvents.emit("event", event);
    for (const [sessionId, call] of eventStreams.entries()) {
      try {
        call.write({ ...event, sessionId: event.sessionId || sessionId });
      } catch {
        eventStreams.delete(sessionId);
      }
    }
    return event;
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
          clientName: call.request.clientName,
          connectedAt: nowMs(),
          lastSeen: nowMs(),
          expiresAt
        });
        publishEvent("client_connected", `${call.request.clientName || "클라이언트"} 연결됨`, {
          sessionId,
          peerDeviceId: call.request.clientDeviceId,
          peerName: call.request.clientName
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

    subscribeEvents(call) {
      try {
        const session = requireSession(call.request.sessionId);
        session.lastSeen = nowMs();
        if (call.request.clientName) {
          session.clientName = call.request.clientName;
        }
        eventStreams.set(call.request.sessionId, call);
        localEvents.emit("clients", connectedClients());
        call.write({
          eventId: randomUUID(),
          type: "server_message",
          unixTimeMs: String(nowMs()),
          message: "서버 이벤트 스트림 연결됨",
          sessionId: call.request.sessionId,
          peerDeviceId: deviceId,
          peerName: deviceName
        });
        let cleaned = false;
        const cleanup = () => {
          if (cleaned) {
            return;
          }
          cleaned = true;
          eventStreams.delete(call.request.sessionId);
          publishEvent("client_disconnected", `${session.clientName || "클라이언트"} 이벤트 스트림 종료`, {
            sessionId: call.request.sessionId,
            peerDeviceId: session.clientDeviceId,
            peerName: session.clientName
          });
          localEvents.emit("clients", connectedClients());
        };
        call.on("cancelled", cleanup);
        call.on("close", cleanup);
      } catch (error) {
        call.destroy(error);
      }
    },

    listClients(call, callback) {
      try {
        requireSession(call.request.sessionId);
        callback(null, { clients: connectedClients() });
      } catch (error) {
        callback(error);
      }
    },

    listFiles(call, callback) {
      try {
        const session = requireSession(call.request.sessionId);
        session.lastSeen = nowMs();
        callback(null, { files: readIndex(receiveDir).map(publicFileEntry) });
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
          session.lastSeen = nowMs();
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
          publishEvent("file_received", `${fileName} 수신 완료`, {
            sessionId: session ? [...sessions.entries()].find(([, value]) => value === session)?.[0] : "",
            peerDeviceId: session?.clientDeviceId ?? "",
            peerName: session?.clientName ?? "",
            file: publicFileEntry(entry)
          });
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
        session.lastSeen = nowMs();
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
    getConnectedClients: connectedClients,
    onEvent: (listener) => {
      localEvents.on("event", listener);
      return () => localEvents.off("event", listener);
    },
    close: async () => {
      ssdp.close();
      descriptor.server.close();
      await new Promise((resolve) => server.tryShutdown(resolve));
    }
  };
}
