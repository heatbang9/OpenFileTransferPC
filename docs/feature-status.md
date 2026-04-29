# OpenFileTransfer PC 피쳐 상태

## 구현 완료

- PC 서버 롤: gRPC 서버, SSDP responder, HTTP descriptor를 실행합니다.
- PC 클라이언트 롤: SSDP 탐색, `Handshake`, `SendFile`, `ReceiveFile`, `ListFiles`, `SubscribeEvents`를 사용합니다.
- UI: 서버 시작/중지, 탐색, 전송, 수신함, 이벤트, 연결 클라이언트, 신뢰 디바이스, 진행률을 표시합니다.
- 시스템 트레이: macOS 메뉴 막대와 Windows 트레이에서 열기, 숨기기, 서버 시작/중지, 종료를 제공합니다.
- 시스템 알림: 파일 수신 완료와 파일 전송 완료 알림을 표시합니다.
- 승인/화이트리스트: 미승인 UUID는 전송마다 확인 팝업을 거치고, 승인된 UUID는 자동 송수신합니다.
- 1:N 전송: 발견된 여러 서버를 선택해 같은 파일을 여러 대상으로 보냅니다.
- 암호화: 각 연결마다 X25519/HKDF-SHA256으로 새 AES-256-GCM 파일 payload 키를 파생합니다.
- macOS/Windows 패키징 준비: `electron-builder` 기반 `pack`, `dist:mac`, `dist:win` 스크립트를 제공합니다.

## 남은 운영 작업

- macOS 배포용 Developer ID 서명 인증서와 notarization 계정 연결이 필요합니다.
- Windows 배포용 코드 서명 인증서가 필요합니다.
- GitHub Releases 기반 auto update는 릴리즈 채널을 정한 뒤 추가합니다.
