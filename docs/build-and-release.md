# PC 앱 빌드와 배포

이 문서는 OpenFileTransfer PC의 macOS/Windows 빌드, 서명, 배포 절차를 정리합니다.

## 현재 상태

- Electron + Node.js 기반 PC 앱입니다.
- `electron-builder`를 사용해 패키징합니다.
- 로컬에서 `npm run pack`으로 macOS unpacked 앱 패키징을 검증했습니다.
- GitHub Actions에서 `npm ci`, `npm run smoke`, `npm run audit:prod`를 검증합니다.
- macOS notarization, Windows code signing, GitHub Releases 자동 업로드는 계정/인증서가 필요하므로 아직 자동화하지 않았습니다.

## 공통 준비

```bash
git submodule update --init --recursive
npm ci
npm run smoke
npm run audit:prod
```

개발 실행:

```bash
npm run dev
```

패키징 dry run:

```bash
npm run pack
```

## macOS 빌드

```bash
npm run dist:mac
```

예상 산출물:

```text
dist/OpenFileTransfer PC-0.1.0-mac-arm64.dmg
dist/OpenFileTransfer PC-0.1.0-mac-arm64.zip
```

Intel Mac 또는 universal 빌드는 `electron-builder` target/arch 설정을 추가한 뒤 진행합니다.

## macOS 서명과 notarization

필요한 것:

- Apple Developer Program 계정
- Developer ID Application 인증서
- Apple notarytool 인증 정보
- 앱 bundle id: `dev.openfiletransfer.pc`

권장 진행:

1. Apple Developer 계정에 가입합니다.
2. Developer ID Application 인증서를 만들고 macOS keychain에 설치합니다.
3. `electron-builder`가 signing identity를 찾을 수 있게 CI keychain 또는 로컬 keychain을 설정합니다.
4. Apple ID app-specific password 또는 App Store Connect API key 기반 notarytool 인증 정보를 준비합니다.
5. `electron-builder` notarize 설정을 추가합니다.
6. DMG/ZIP을 생성하고 Gatekeeper 확인을 통과하는지 검증합니다.

현재는 인증서가 없으면 ad-hoc signing 또는 unsigned에 가까운 개발 패키지만 생성됩니다. 사용자 배포용 macOS 앱은 Developer ID 서명과 notarization을 거쳐야 경고가 줄어듭니다.

## Windows 빌드

```bash
npm run dist:win
```

예상 산출물:

```text
dist/OpenFileTransfer PC-0.1.0-win-x64.exe
dist/OpenFileTransfer PC-0.1.0-win-x64.zip
```

Windows 산출물은 Windows runner에서 빌드하는 방식을 권장합니다. macOS에서도 일부 Windows 빌드가 가능하지만, 서명/검증은 Windows 환경이 더 안정적입니다.

## Windows code signing

필요한 것:

- Microsoft Trusted Signing 또는 일반 Authenticode code signing 인증서
- timestamp server 설정
- CI secret 또는 Azure/Microsoft signing 연동

권장 진행:

1. Microsoft Trusted Signing 또는 인증기관 코드 서명 인증서를 준비합니다.
2. `electron-builder`의 Windows signing 설정을 추가합니다.
3. GitHub Actions Windows runner에서 `npm run dist:win`을 실행합니다.
4. 설치 파일과 unpacked exe 서명을 검증합니다.
5. SmartScreen 평판은 배포 초기에는 즉시 쌓이지 않을 수 있으므로 내부 배포/테스트 채널을 먼저 운영합니다.

## GitHub Releases 배포 방향

1. 태그 형식을 정합니다. 예: `pc-v0.1.0`
2. macOS runner에서 `npm run dist:mac` 실행
3. Windows runner에서 `npm run dist:win` 실행
4. 산출물을 GitHub Release에 업로드
5. auto update를 붙일 경우 `electron-updater`와 release provider 설정 추가

## 릴리즈 전 체크리스트

- macOS: 앱 실행, 트레이, 서버 시작/중지, SSDP 탐색, 파일 송수신 검증
- Windows: 앱 실행, 트레이, 서버 시작/중지, 방화벽 팝업 UX, 파일 송수신 검증
- 미승인 UUID 승인 팝업과 화이트리스트 검증
- 1:N 전송과 대상별 진행률 검증
- 시스템 알림 표시 검증
- 서명/노타라이즈/SmartScreen 경고 수준 확인

## 공식 참고

- Electron code signing: <https://www.electronjs.org/docs/latest/tutorial/code-signing>
- electron-builder macOS signing: <https://www.electron.build/code-signing-mac>
- Apple notarization: <https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution>
- Microsoft Windows code signing options: <https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options>
