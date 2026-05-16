# phone

React Native + Expo 앱 — 핸드폰 사용 시간 관리 및 캐릭터 커스터마이징.

## 사전 준비

- Node.js 18 이상
- Expo 계정 (EAS Build 사용 시)
- Android: Android Studio + 에뮬레이터 또는 실기기
- iOS: EAS Build 필요 (Expo Go 미지원)

## 설치

```bash
npm install
```

## 실행

### Android (로컬 빌드)

```bash
npx expo prebuild
npm run android
```

### Development Build (EAS)

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform android   # 또는 ios
```

빌드 완료 후 기기에 설치하고 아래 명령어로 서버 실행:

```bash
npm start
```

## 캐릭터 파일

- 메인 캐릭터: `assets/character/character.glb`
- 아이템 모델: `assets/item/`
- 아이템 썸네일: `assets/itemThumbnail/`
