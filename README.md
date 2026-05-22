# otium

집중 시간 관리 + 캐릭터 커스터마이징 앱 (React Native + Expo)

## 프로젝트 구조

```
otium/
  app/    # React Native 앱 (Expo)
  back/   # Spring Boot 백엔드
```

---

## 시작하기 (앱)

### 사전 준비

- [Node.js 18+](https://nodejs.org)
- [Expo Go](https://expo.dev/go) — 핸드폰에 설치 (iOS / Android)
- 핸드폰과 개발 PC가 **같은 와이파이**에 연결되어 있어야 해요

### 설치 및 실행

```bash
cd app
npm install
npm start
```

터미널에 QR코드가 뜨면 Expo Go 앱으로 스캔하면 바로 실행돼요.

> iOS는 기본 카메라 앱으로 QR 스캔 → Expo Go에서 열기  
> Android는 Expo Go 앱 내 QR 스캔 버튼 사용

---

## 로그인

현재 **목업 로그인**으로 구현되어 있어요.  
카카오 로그인 버튼을 누르면 테스트 계정으로 바로 진입합니다.  
실제 카카오 연동은 백엔드 서버 준비 후 적용 예정이에요.

---

## 자주 쓰는 명령어

| 명령어 | 설명 |
|--------|------|
| `npm start` | Expo 개발 서버 시작 (Expo Go용) |
| `npm run ios` | iOS 시뮬레이터 실행 |
| `npm run android` | Android 에뮬레이터 실행 |
| `npm run web` | 웹 브라우저 실행 |

---

## 기술 스택

- React Native 0.81
- Expo SDK 54
- React Navigation (Bottom Tabs)
