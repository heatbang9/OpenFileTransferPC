import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "./server.js";
import { listClients, listFiles, receiveFile, sendFile, subscribeEvents } from "./client.js";
import { discoverServers } from "./discovery.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oft-smoke-"));
const receiveDir = path.join(tempRoot, "server-received");
const downloadDir = path.join(tempRoot, "client-downloaded");
const samplePath = path.join(tempRoot, "sample.txt");

fs.writeFileSync(samplePath, "OpenFileTransfer smoke test\n암호화된 chunk 전송 확인\n");

const server = await startServer({
  name: "Smoke Test Server",
  grpcPort: 39191,
  descriptorPort: 39192,
  receiveDir
});

try {
  const devices = await discoverServers({ timeoutMs: 1200 });
  if (!devices.some((device) => device.deviceId === server.deviceId)) {
    throw new Error("SSDP 탐색에서 테스트 서버를 찾지 못했습니다.");
  }

  let receivedEvent;
  const subscription = await subscribeEvents("127.0.0.1:39191", (event) => {
    if (event.type === "file_received") {
      receivedEvent = event;
    }
  }, { name: "Smoke Event Client" });

  const receipt = await sendFile("127.0.0.1:39191", samplePath, { name: "Smoke Client" });
  if (!receipt.stored) {
    throw new Error("파일 저장 receipt가 false입니다.");
  }

  await new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (receivedEvent) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > 2000) {
        clearInterval(timer);
        reject(new Error("서버 이벤트 스트림에서 file_received 이벤트를 받지 못했습니다."));
      }
    }, 50);
  });

  const clients = await listClients("127.0.0.1:39191", { name: "Smoke Inspector" });
  if (!clients.clients.some((client) => client.eventStreamOpen)) {
    throw new Error("이벤트 스트림이 열린 클라이언트 상태를 확인하지 못했습니다.");
  }

  const list = await listFiles("127.0.0.1:39191");
  if (list.files.length !== 1) {
    throw new Error("수신 파일 목록 개수가 예상과 다릅니다.");
  }

  const downloaded = await receiveFile("127.0.0.1:39191", list.files[0].fileId, downloadDir);
  const original = fs.readFileSync(samplePath, "utf8");
  const restored = fs.readFileSync(downloaded.outputPath, "utf8");
  if (original !== restored) {
    throw new Error("다운로드한 파일 내용이 원본과 다릅니다.");
  }

  subscription.close();
  console.log("PC gRPC 파일 송수신 smoke test를 통과했습니다.");
} finally {
  await server.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
