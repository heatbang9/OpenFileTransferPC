const api = window.openFileTransfer;

let selectedDevice;
let selectedFile;

const statusText = document.querySelector("#statusText");
const deviceList = document.querySelector("#deviceList");
const inboxList = document.querySelector("#inboxList");
const clientList = document.querySelector("#clientList");
const eventList = document.querySelector("#eventList");
const selectedDeviceText = document.querySelector("#selectedDevice");
const selectedFileText = document.querySelector("#selectedFile");
const sendButton = document.querySelector("#sendButton");
const trayStatusText = document.querySelector("#trayStatusText");
const events = [];

function setStatus(text) {
  statusText.textContent = text;
}

function updateSendState() {
  sendButton.disabled = !selectedDevice || !selectedFile;
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
      selectedDevice = device;
      selectedDeviceText.textContent = `${device.deviceName ?? "서버"} (${device.address})`;
      document.querySelectorAll(".item.selected").forEach((node) => node.classList.remove("selected"));
      button.classList.add("selected");
      updateSendState();
      api.subscribeEvents(device.address).then(() => {
        setStatus("원격 서버 이벤트 구독 중");
      }).catch(() => {
        setStatus("원격 서버 이벤트 구독 실패");
      });
      refreshInbox();
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

async function refreshClients() {
  renderClients(await api.serverClients());
}

function addEvent(event, source) {
  events.push({ ...event, type: `${source}:${event.type}` });
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
});

document.querySelector("#stopServerButton").addEventListener("click", async () => {
  await api.stopServer();
  setStatus("서버 중지됨");
});

document.querySelector("#discoverButton").addEventListener("click", async () => {
  setStatus("서버 탐색 중");
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
  if (!selectedDevice || !selectedFile) {
    return;
  }
  setStatus("파일 전송 중");
  await api.sendFile({ address: selectedDevice.address, filePath: selectedFile });
  setStatus("파일 전송 완료");
  await refreshInbox();
});

document.querySelector("#refreshInboxButton").addEventListener("click", refreshInbox);
document.querySelector("#refreshClientsButton").addEventListener("click", refreshClients);
document.querySelector("#clearEventsButton").addEventListener("click", () => {
  events.length = 0;
  renderEvents();
});

document.querySelector("#hideToTrayButton").addEventListener("click", async () => {
  await api.hideToTray();
});

document.querySelector("#quitButton").addEventListener("click", async () => {
  await api.quit();
});

api.onServerEvent((event) => addEvent(event, "내 서버"));
api.onServerClients(renderClients);
api.onClientEvent((event) => addEvent(event, "원격 서버"));
api.onTrayState((state) => {
  trayStatusText.textContent = state.message ?? (
    state.hidden
      ? "메뉴 막대 또는 작업 표시줄의 OpenFileTransfer 아이콘에서 다시 열 수 있습니다."
      : "창이 표시되어 있습니다."
  );
});

updateSendState();
renderEvents();
