import path from "node:path";
import { fileURLToPath } from "node:url";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const protoPath = path.join(repoRoot, "proto/proto/openfiletransfer/v1/transfer.proto");

export function loadTransferProto() {
  const packageDefinition = protoLoader.loadSync(protoPath, {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  });

  return grpc.loadPackageDefinition(packageDefinition).openfiletransfer.v1;
}

export function createClient(address) {
  const proto = loadTransferProto();
  return new proto.TransferService(address, grpc.credentials.createInsecure());
}

export { grpc, protoPath };
