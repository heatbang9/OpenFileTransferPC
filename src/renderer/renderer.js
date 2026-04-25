const api = window.openFileTransfer;

let selectedDevice;
let selectedFile;

const statusText = document.querySelector("#statusText");
const deviceList = document.querySelector("#deviceList");
const inboxList = document.querySelector("#inboxList");
const selectedDeviceText = document.querySelector("#selectedDevice");
const selectedFileText = document.querySelector("#selectedFile");
const sendButton = document.querySelector("#sendButton");

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

updateSendState();
