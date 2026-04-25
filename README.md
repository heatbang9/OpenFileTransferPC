# OpenFileTransfer PC

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
- 서버 수신함 목록 조회

## 디자인 콘셉트

앱 아이콘은 연한 민트색 둥근 배경, 태극형 양방향 흐름, 위/아래 화살표를 조합했습니다. UI도 같은 민트/틸 색상과 8px radius 버튼으로 맞췄습니다.

브랜드 자산:

- `assets/brand/openfiletransfer-mark.svg`
- `assets/brand/openfiletransfer-icon-1024.png`
- `assets/brand/openfiletransfer-icon-512.png`

## macOS/Windows 배포 방향

1단계는 Electron 개발 앱과 CLI 테스트입니다. 2단계에서 `electron-builder` 또는 Electron Forge를 붙여 다음 산출물을 만듭니다.

- macOS: signed `.dmg` 또는 `.zip`, notarization
- Windows: signed `.exe` installer
- 업데이트: GitHub Releases 기반 auto update
