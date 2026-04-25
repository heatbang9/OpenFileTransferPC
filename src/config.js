import os from "node:os";
import path from "node:path";

export const SERVICE_TYPE = "urn:openfiletransfer:service:file-transfer:1";
export const DEFAULT_GRPC_PORT = 39091;
export const DEFAULT_DESCRIPTOR_PORT = 39092;
export const DEFAULT_RECEIVE_DIR = path.resolve("received");
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const CIPHER = "x25519-hkdf-sha256+aes-256-gcm";

export function defaultDeviceName() {
  return `${os.hostname()} PC`;
}

export function nowMs() {
  return Date.now();
}
