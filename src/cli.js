#!/usr/bin/env node
import { Command } from "commander";
import { DEFAULT_DESCRIPTOR_PORT, DEFAULT_GRPC_PORT, DEFAULT_RECEIVE_DIR } from "./config.js";
import { discoverServers } from "./discovery.js";
import { listClients, listFiles, ping, receiveFile, sendFile, subscribeEvents } from "./client.js";
import { startServer } from "./server.js";

const program = new Command();

program
  .name("oftpc")
  .description("OpenFileTransfer PC 서버/클라이언트")
  .version("0.1.0");

const server = program.command("server").description("PC 서버 롤");

server
  .command("start")
  .description("gRPC 서버와 SSDP 응답기를 시작합니다.")
  .option("--name <name>", "디바이스 이름")
  .option("--grpc-port <port>", "gRPC 포트", String(DEFAULT_GRPC_PORT))
  .option("--descriptor-port <port>", "디바이스 descriptor HTTP 포트", String(DEFAULT_DESCRIPTOR_PORT))
  .option("--receive-dir <dir>", "수신 파일 저장 경로", DEFAULT_RECEIVE_DIR)
  .action(async (options) => {
    const started = await startServer(options);
    console.log(`서버 시작: ${started.deviceName}`);
    console.log(`gRPC 주소: 0.0.0.0:${started.grpcPort}`);
    console.log(`Descriptor: ${started.descriptorUrl}`);
    console.log(`수신함: ${started.receiveDir}`);
    process.on("SIGINT", async () => {
      await started.close();
      process.exit(0);
    });
  });

const client = program.command("client").description("PC 클라이언트 롤");

client
  .command("discover")
  .description("로컬 네트워크에서 서버 디바이스를 찾습니다.")
  .option("--timeout <ms>", "탐색 시간", "3000")
  .action(async (options) => {
    const devices = await discoverServers({ timeoutMs: Number(options.timeout) });
    console.log(JSON.stringify(devices, null, 2));
  });

client
  .command("ping")
  .requiredOption("--address <host:port>", "gRPC 주소")
  .action(async (options) => {
    console.log(JSON.stringify(await ping(options.address), null, 2));
  });

client
  .command("send")
  .requiredOption("--address <host:port>", "gRPC 주소")
  .requiredOption("--file <path>", "보낼 파일")
  .action(async (options) => {
    console.log(JSON.stringify(await sendFile(options.address, options.file), null, 2));
  });

client
  .command("list")
  .requiredOption("--address <host:port>", "gRPC 주소")
  .action(async (options) => {
    console.log(JSON.stringify(await listFiles(options.address), null, 2));
  });

client
  .command("clients")
  .requiredOption("--address <host:port>", "gRPC 주소")
  .action(async (options) => {
    console.log(JSON.stringify(await listClients(options.address), null, 2));
  });

client
  .command("events")
  .requiredOption("--address <host:port>", "gRPC 주소")
  .action(async (options) => {
    const subscription = await subscribeEvents(options.address, (event) => {
      console.log(JSON.stringify(event));
    });
    process.on("SIGINT", () => {
      subscription.close();
      process.exit(0);
    });
  });

client
  .command("receive")
  .requiredOption("--address <host:port>", "gRPC 주소")
  .requiredOption("--file-id <id>", "받을 file id")
  .option("--out <dir>", "저장 폴더", ".")
  .action(async (options) => {
    console.log(JSON.stringify(await receiveFile(options.address, options.fileId, options.out), null, 2));
  });

program.parseAsync();
