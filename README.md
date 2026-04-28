# OpenFileTransfer PC

![OpenFileTransfer PC icon](assets/brand/openfiletransfer-icon-512.png)

macOS와 Windows를 우선 대상으로 하는 OpenFileTransfer PC 앱입니다.

## 현재 선택

PC 앱은 Electron + Node.js로 시작합니다. 기존 Node gRPC/SSDP 코어를 그대로 재사용할 수 있고, macOS/Windows 패키징과 자동 업데이트 경로가 가장 단순합니다.

## 실행

```bash
git submodule update --init --recursive
npm install
npm run dev
```

CLI 테스트도 함께 사용할 수 있습니다.

```bash
npm run smoke
npm run oftpc -- server start
npm run oftpc -- client discover
```

## UI 범위

- 서버 롤 시작/중지
- 로컬 네트워크 서버 탐색
- 선택한 서버로 파일 전송
- 서버 이벤트 구독
- 내 서버에 연결된 클라이언트 확인
- 구독 중인 클라이언트와 신뢰 디바이스 목록 확인
- 시스템 트레이 숨김/복귀/종료 메뉴
- 서버 수신함 목록 조회
- 송신/수신 진행률 표시
- 전송/수신 완료 시스템 알림

## 시스템 트레이 동작

- 창 닫기 버튼은 앱 종료가 아니라 트레이 숨김으로 동작합니다.
- macOS 메뉴 막대 또는 Windows 작업 표시줄 트레이의 OpenFileTransfer 아이콘에서 앱을 다시 열 수 있습니다.
- 트레이 메뉴에서 `OpenFileTransfer 열기`, `트레이로 숨기기`, `서버 시작`, `서버 중지`, `종료`를 제공합니다.
- 서버가 실행 중인 상태로 창을 숨겨도 gRPC 서버와 이벤트 스트림은 유지됩니다.
- 완전히 종료하려면 UI의 `앱 종료` 버튼이나 트레이 메뉴의 `종료`를 사용합니다.
- macOS/Windows Electron `Notification` API로 파일 수신 완료와 파일 전송 완료 알림을 표시합니다.
- Windows 알림 식별을 위해 앱 실행 시 `dev.openfiletransfer.pc` AppUserModelID를 설정합니다.

참고 문서: [Electron Tray API](https://www.electronjs.org/docs/latest/api/tray)

## 전송 진행률

- PC 클라이언트가 원격 서버로 파일을 보낼 때 `전송 진행률` 패널에 송신 퍼센트와 바이트 수가 표시됩니다.
- PC 서버가 모바일/다른 PC 클라이언트에서 파일을 받을 때 같은 패널에 수신 진행률이 표시됩니다.
- 원격 클라이언트가 `ReceiveFile`로 PC 서버 수신함 파일을 받아갈 때 서버 UI에는 해당 클라이언트로 보내는 송신 진행률이 표시됩니다.
- 완료된 항목은 패널에 남아 사용자가 지울 수 있습니다.

## 현재 동작

- PC 앱은 서버 롤과 클라이언트 롤을 모두 수행합니다.
- PC에서 서버를 켜면 모바일/다른 PC 클라이언트가 `Handshake` 후 접속할 수 있습니다.
- 서버가 클라이언트에 먼저 알림을 보내는 동작은 클라이언트가 `SubscribeEvents` 스트림을 열어둔 경우 가능합니다.
- 서버 UI의 `내 서버 접속 클라이언트` 영역에서 현재 세션과 이벤트 스트림 상태를 볼 수 있습니다.
- 서버 UI의 `구독/신뢰 디바이스` 영역에서 한 번 이상 `Handshake`한 디바이스 UUID, 이름, 구독 상태, 전송 횟수를 볼 수 있습니다.
- 원격 서버를 선택하면 PC 앱도 해당 서버의 이벤트 스트림을 구독하고 `이벤트` 영역에 표시합니다.

gRPC 특성상 서버가 아무 연결도 없는 모바일 앱에 임의로 먼저 접속해 이벤트를 보낼 수는 없습니다. 클라이언트 앱이 서버와 연결된 뒤 이벤트 스트림을 유지해야 서버 주도 알림처럼 동작합니다.

## 디바이스 식별과 암호화

- PC 앱은 자체 UUID를 앱 데이터 폴더에 저장하고 서버/클라이언트 역할 모두에서 재사용합니다.
- 모바일/PC 클라이언트도 UUID와 이름을 `Handshake`에 포함하므로 서버는 같은 UUID를 같은 디바이스로 인식합니다.
- UUID는 디바이스 식별과 신뢰 목록 표시용입니다. 파일 암호화 키는 UUID만 보고 재사용하지 않습니다.
- 각 연결은 새 X25519 임시 키로 `Handshake`하고 HKDF-SHA256으로 새 AES-256-GCM 세션 키를 파생합니다.
- 이렇게 하면 사용성은 “같은 디바이스로 보임”을 유지하고, 보안은 매 세션 새 키를 쓰는 forward secrecy 방향을 유지합니다.

## 디자인 콘셉트

앱 아이콘은 이미지 생성 모델로 만든 민트색 파일 전송 아이콘을 사용합니다. 상단에는 우측에서 좌측으로 흐르는 큰 화살표, 하단에는 좌측에서 우측으로 흐르는 큰 화살표, 중앙에는 파일 문서가 있어 파일 전달 앱이라는 의미가 바로 보이도록 했습니다. UI도 같은 민트/틸 색상과 8px radius 버튼으로 맞췄습니다.

자세한 디자인 가이드는 [docs/brand-design.md](docs/brand-design.md)를 참고하세요.

브랜드 자산:

- `assets/brand/openfiletransfer-mark.svg`
- `assets/brand/openfiletransfer-icon-generated.png`
- `assets/brand/openfiletransfer-icon-1024.png`
- `assets/brand/openfiletransfer-icon-512.png`

## macOS/Windows 배포 방향

1단계는 Electron 개발 앱과 CLI 테스트입니다. 2단계에서 `electron-builder` 또는 Electron Forge를 붙여 다음 산출물을 만듭니다.

- macOS: signed `.dmg` 또는 `.zip`, notarization
- Windows: signed `.exe` installer
- 업데이트: GitHub Releases 기반 auto update
