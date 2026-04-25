import dgram from "node:dgram";
import http from "node:http";
import os from "node:os";
import { SERVICE_TYPE } from "./config.js";

const SSDP_HOST = "239.255.255.250";
const SSDP_PORT = 1900;

function localIPv4() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}

function parseHeaders(message) {
  const lines = message.toString().split(/\r?\n/);
  const headers = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index > 0) {
      headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
  }
  return { startLine: lines[0] ?? "", headers };
}

function buildSearchResponse({ deviceId, location }) {
  return [
    "HTTP/1.1 200 OK",
    "CACHE-CONTROL: max-age=60",
    "EXT:",
    `LOCATION: ${location}`,
    "SERVER: OpenFileTransfer/0.1 Node.js",
    `ST: ${SERVICE_TYPE}`,
    `USN: uuid:${deviceId}::${SERVICE_TYPE}`,
    "",
    ""
  ].join("\r\n");
}

function buildNotify({ deviceId, location }) {
  return [
    "NOTIFY * HTTP/1.1",
    `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
    "CACHE-CONTROL: max-age=60",
    `LOCATION: ${location}`,
    `NT: ${SERVICE_TYPE}`,
    "NTS: ssdp:alive",
    "SERVER: OpenFileTransfer/0.1 Node.js",
    `USN: uuid:${deviceId}::${SERVICE_TYPE}`,
    "",
    ""
  ].join("\r\n");
}

export function startDescriptorServer({ deviceId, deviceName, grpcPort, descriptorPort }) {
  const host = localIPv4();
  const server = http.createServer((req, res) => {
    if (req.url !== "/device.json") {
      res.writeHead(404);
      res.end();
      return;
    }

    const body = JSON.stringify({
      deviceId,
      deviceName,
      grpcHost: host,
      grpcPort,
      serviceType: SERVICE_TYPE,
      capabilities: ["grpc", "send-file", "receive-file", "app-payload-encryption"]
    });

    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(body);
  });

  return new Promise((resolve) => {
    server.listen(descriptorPort, "0.0.0.0", () => {
      resolve({
        server,
        location: `http://${host}:${descriptorPort}/device.json`
      });
    });
  });
}

export function startSsdpResponder({ deviceId, location }) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const response = Buffer.from(buildSearchResponse({ deviceId, location }));
  const notify = Buffer.from(buildNotify({ deviceId, location }));

  socket.on("message", (message, rinfo) => {
    const { startLine, headers } = parseHeaders(message);
    const target = headers.st ?? "";
    if (!startLine.startsWith("M-SEARCH") || (target !== SERVICE_TYPE && target !== "ssdp:all")) {
      return;
    }
    socket.send(response, rinfo.port, rinfo.address);
  });

  const sendNotify = () => socket.send(notify, SSDP_PORT, SSDP_HOST);
  let timer;

  return new Promise((resolve) => {
    socket.bind(SSDP_PORT, () => {
      try {
        socket.addMembership(SSDP_HOST);
      } catch {
        // 일부 OS에서는 이미 membership이 잡혀 있으면 예외가 날 수 있습니다.
      }
      socket.setMulticastTTL(2);
      sendNotify();
      timer = setInterval(sendNotify, 30_000);
      resolve({
        close: () => {
          clearInterval(timer);
          socket.close();
        }
      });
    });
  });
}

export async function discoverServers({ timeoutMs = 3000 } = {}) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  const found = new Map();
  const search = Buffer.from([
    "M-SEARCH * HTTP/1.1",
    `HOST: ${SSDP_HOST}:${SSDP_PORT}`,
    "MAN: \"ssdp:discover\"",
    "MX: 1",
    `ST: ${SERVICE_TYPE}`,
    "",
    ""
  ].join("\r\n"));

  socket.on("message", async (message, rinfo) => {
    const { headers } = parseHeaders(message);
    if (headers.st !== SERVICE_TYPE || !headers.location) {
      return;
    }

    try {
      const response = await fetch(headers.location, { signal: AbortSignal.timeout(1200) });
      const descriptor = await response.json();
      found.set(descriptor.deviceId, {
        ...descriptor,
        address: `${descriptor.grpcHost}:${descriptor.grpcPort}`,
        ssdpFrom: rinfo.address,
        location: headers.location
      });
    } catch {
      found.set(headers.usn ?? headers.location, {
        address: rinfo.address,
        location: headers.location
      });
    }
  });

  return new Promise((resolve) => {
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(search, SSDP_PORT, SSDP_HOST);
      setTimeout(() => {
        socket.close();
        resolve([...found.values()]);
      }, timeoutMs);
    });
  });
}

