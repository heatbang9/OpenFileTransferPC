const api = window.openFileTransfer;

let selectedDevice;
let selectedFile;
const selectedDevices = new Map();

const statusText = document.querySelector("#statusText");
const deviceList = document.querySelector("#deviceList");
const inboxList = document.querySelector("#inboxList");
const clientList = document.querySelector("#clientList");
const knownDeviceList = document.querySelector("#knownDeviceList");
const eventList = document.querySelector("#eventList");
const transferList = document.querySelector("#transferList");
const selectedDeviceText = document.querySelector("#selectedDevice");
const selectedFileText = document.querySelector("#selectedFile");
const sendButton = document.querySelector("#sendButton");
const trayStatusText = document.querySelector("#trayStatusText");
const events = [];
const transfers = new Map();

function setStatus(text) {
  statusText.textContent = text;
}

function updateSendState() {
  sendButton.disabled = selectedDevices.size === 0 || !selectedFile;
  const label = selectedDevices.size > 1 ? `${selectedDevices.size}개 서버에 보내기` : "보내기";
  sendButton.innerHTML = `<span class="buttonIcon iconTransfer"></span>${label}`;
}

function renderDevices(devices) {
  if (!devices.length) {
    deviceList.className = "list empty";
    deviceList.textContent = "찾은 서버가 없습니다.";
    return;
  }

  deviceList.className = "list";
  deviceList.replaceChildren(...devices.map((device) => {
    const button = document.createElement("button");
    button.className = "item";
    button.innerHTML = `
      <strong>${device.deviceName ?? "이름 없는 서버"}</strong>
      <span class="muted">${device.address ?? "주소 없음"}</span>
    `;
    button.addEventListener("click", () => {
      const key = device.address ?? device.deviceId;
      if (selectedDevices.has(key)) {
        selectedDevices.delete(key);
        button.classList.remove("selected");
      } else {
        selectedDevices.set(key, device);
        selectedDevice = device;
        button.classList.add("selected");
      }
      const selectedNames = [...selectedDevices.values()].map((item) => item.deviceName ?? item.address);
      selectedDevice = [...selectedDevices.values()].at(-1);
      selectedDeviceText.textContent = selectedNames.length
        ? selectedNames.join(", ")
        : "없음";
      updateSendState();
      if (selectedDevice?.address) {
        api.subscribeEvents(selectedDevice.address).then(() => {
          setStatus("원격 서버 이벤트 구독 중");
        }).catch(() => {
          setStatus("원격 서버 이벤트 구독 실패");
        });
        refreshInbox();
      }
    });
    return button;
  }));
}

function renderInbox(files) {
  if (!files.length) {
    inboxList.className = "list empty";
    inboxList.textContent = "수신 파일이 없습니다.";
    return;
  }

  inboxList.className = "list";
  inboxList.replaceChildren(...files.map((file) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <strong>${file.fileName}</strong>
      <span class="muted">${file.size} bytes · ${file.sha256Hex}</span>
    `;
    return row;
  }));
}

function renderClients(clients) {
  if (!clients.length) {
    clientList.className = "list empty";
    clientList.textContent = "연결된 클라이언트가 없습니다.";
    return;
  }

  clientList.className = "list";
  clientList.replaceChildren(...clients.map((client) => {
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <strong>${client.clientName || "이름 없는 클라이언트"}</strong>
      <span class="muted">${client.clientDeviceId || "device id 없음"} · 이벤트 스트림 ${client.eventStreamOpen ? "열림" : "닫힘"}</span>
    `;
    return row;
  }));
}

function renderKnownDevices(devices) {
  if (!devices.length) {
    knownDeviceList.className = "list empty";
    knownDeviceList.textContent = "아직 신뢰 디바이스가 없습니다.";
    return;
  }

  knownDeviceList.className = "list";
  knownDeviceList.replaceChildren(...devices.map((device) => {
    const row = document.createElement("div");
    row.className = "item";
    const trusted = device.trusted === true;
    row.innerHTML = `
      <div class="itemHeader">
        <strong>${device.clientName || "이름 없는 클라이언트"}</strong>
        <span class="trustBadge ${trusted ? "trusted" : "untrusted"}">${trusted ? "승인됨" : "승인 필요"}</span>
      </div>
      <span class="muted">${device.clientDeviceId || "device id 없음"} · 구독 ${device.eventStreamOpen ? "열림" : "닫힘"} · 전송 ${device.transferCount ?? 0}회</span>
      <div class="itemActions">
        <button class="${trusted ? "secondary" : ""}" data-device-id="${device.clientDeviceId}" data-trusted="${trusted ? "false" : "true"}">
          ${trusted ? "승인 해제" : "화이트리스트 승인"}
        </button>
      </div>
    `;
    row.querySelector("button").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      await api.setDeviceTrust({
        clientDeviceId: button.dataset.deviceId,
        trusted: button.dataset.trusted === "true"
      });
      await refreshKnownDevices();
    });
    return row;
  }));
}

function renderEvents() {
  if (!events.length) {
    eventList.className = "list empty";
    eventList.textContent = "아직 이벤트가 없습니다.";
    return;
  }

  eventList.className = "list";
  eventList.replaceChildren(...events.slice(-20).reverse().map((event) => {
    const row = document.createElement("div");
    row.className = "item";
    const fileText = event.file?.fileName ? ` · ${event.file.fileName}` : "";
    row.innerHTML = `
      <strong>${event.type ?? "event"}${fileText}</strong>
      <span class="muted">${event.message ?? ""}</span>
    `;
    return row;
  }));
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function renderTransfers() {
  const items = [...transfers.values()].slice(-20).reverse();
  if (!items.length) {
    transferList.className = "list empty";
    transferList.textContent = "송신/수신 진행률이 여기에 표시됩니다.";
    return;
  }

  transferList.className = "list";
  transferList.replaceChildren(...items.map((transfer) => {
    const row = document.createElement("div");
    const percent = Math.max(0, Math.min(100, Math.round((transfer.progress ?? 0) * 100)));
    const directionText = transfer.direction === "receiving" ? "수신" : "송신";
    const peerText = transfer.peerName ? ` · ${transfer.peerName}` : "";
    row.className = `item transferItem ${percent >= 100 ? "complete" : ""}`;
    row.innerHTML = `
      <div class="transferTitle">
        <strong>${directionText} · ${transfer.fileName || "이름 없는 파일"}</strong>
        <span>${percent}%</span>
      </div>
      <div class="progressTrack">
        <div class="progressFill" style="width: ${percent}%"></div>
      </div>
      <span class="muted">${formatBytes(transfer.transferredBytes)} / ${formatBytes(transfer.totalBytes)}${peerText}</span>
    `;
    return row;
  }));
}

function updateTransferProgress(progress) {
  const key = progress.transferId
    || `${progress.source ?? "app"}:${progress.direction}:${progress.fileName}:${progress.totalBytes}`;
  transfers.set(key, {
    ...progress,
    transferredBytes: Number(progress.transferredBytes ?? 0),
    totalBytes: Number(progress.totalBytes ?? 0),
    progress: Number(progress.progress ?? 0)
  });
  renderTransfers();
}

async function refreshClients() {
  renderClients(await api.serverClients());
}

async function refreshKnownDevices() {
  renderKnownDevices(await api.serverKnownDevices());
}

function addEvent(event, source) {
  events.push({ ...event, type: `${source}:${event.type}` });
  renderEvents();
}

function addTransferRequest(request) {
  events.push({
    type: "승인 요청",
    message: `${request.peerName} · ${request.fileName || "이름 없는 파일"}`
  });
  renderEvents();
}

async function refreshInbox() {
  if (!selectedDevice?.address) {
    return;
  }
  setStatus("수신함 조회 중");
  const response = await api.listFiles(selectedDevice.address);
  renderInbox(response.files ?? []);
  setStatus("수신함 조회 완료");
}

document.querySelector("#startServerButton").addEventListener("click", async () => {
  setStatus("서버 시작 중");
  const server = await api.startServer({});
  setStatus(`서버 실행 중 · ${server.descriptorUrl}`);
  await refreshClients();
  await refreshKnownDevices();
});

document.querySelector("#stopServerButton").addEventListener("click", async () => {
  await api.stopServer();
  setStatus("서버 중지됨");
});

document.querySelector("#discoverButton").addEventListener("click", async () => {
  setStatus("서버 탐색 중");
  selectedDevices.clear();
  selectedDevice = undefined;
  selectedDeviceText.textContent = "없음";
  updateSendState();
  const devices = await api.discover({ timeoutMs: 2200 });
  renderDevices(devices);
  setStatus(`탐색 완료 · ${devices.length}개`);
});

document.querySelector("#pickFileButton").addEventListener("click", async () => {
  selectedFile = await api.pickFile();
  selectedFileText.textContent = selectedFile ?? "없음";
  updateSendState();
});

sendButton.addEventListener("click", async () => {
  if (!selectedDevices.size || !selectedFile) {
    return;
  }
  const targets = [...selectedDevices.values()].map((device) => device.address).filter(Boolean);
  setStatus(`파일 전송 중 · 대상 ${targets.length}개`);
  const results = targets.length === 1
    ? [await api.sendFile({ address: targets[0], filePath: selectedFile }).then((receipt) => ({ ok: true, receipt })).catch((error) => ({ ok: false, error: String(error?.message ?? error) }))]
    : await api.sendFiles({ addresses: targets, filePath: selectedFile });
  const successCount = results.filter((result) => result.ok).length;
  setStatus(`파일 전송 완료 · 성공 ${successCount}/${targets.length}`);
  await refreshInbox();
});

document.querySelector("#refreshInboxButton").addEventListener("click", refreshInbox);
document.querySelector("#refreshClientsButton").addEventListener("click", refreshClients);
document.querySelector("#refreshKnownDevicesButton").addEventListener("click", refreshKnownDevices);
document.querySelector("#clearEventsButton").addEventListener("click", () => {
  events.length = 0;
  renderEvents();
});
document.querySelector("#clearTransfersButton").addEventListener("click", () => {
  transfers.clear();
  renderTransfers();
});

document.querySelector("#hideToTrayButton").addEventListener("click", async () => {
  await api.hideToTray();
});

document.querySelector("#quitButton").addEventListener("click", async () => {
  await api.quit();
});

api.onServerEvent((event) => addEvent(event, "내 서버"));
api.onServerClients(renderClients);
api.onServerKnownDevices(renderKnownDevices);
api.onClientEvent((event) => addEvent(event, "원격 서버"));
api.onTransferProgress(updateTransferProgress);
api.onTransferRequest(addTransferRequest);
api.onTrayState((state) => {
  trayStatusText.textContent = state.message ?? (
    state.hidden
      ? "메뉴 막대 또는 작업 표시줄의 OpenFileTransfer 아이콘에서 다시 열 수 있습니다."
      : "창이 표시되어 있습니다."
  );
});

updateSendState();
renderEvents();
renderTransfers();
