# otium

React Native + Expo 앱 — 집중 시간 관리 및 캐릭터 커스터마이징.

## 사전 준비

- Node.js 18 이상
- Expo Go 앱 (iOS / Android)
- 카카오 개발자 계정 및 네이티브 앱 키

## 설치

```bash
npm install
```

## 환경변수 설정

`.env.example`을 복사해서 `.env` 파일 생성:

```bash
cp .env.example .env
```

`.env` 파일에 카카오 네이티브 앱 키 입력:

```
KAKAO_NATIVE_APP_KEY=your_kakao_native_app_key_here
```

## 실행 (Expo Go)

```bash
npm run start:go
```

QR코드를 Expo Go 앱으로 스캔하면 실행돼요.

> Expo Go SDK 54 이상 필요

## 실기기 테스트 (카카오 로그인)

카카오 로그인은 네이티브 모듈을 사용하므로 EAS Build가 필요해요.

```bash
npm install -g eas-cli
eas login
eas build --platform ios --profile development
```

빌드 완료 후 기기에 설치하고 서버 실행:

```bash
npm start
```
