# gromo

집중 시간 관리 + 캐릭터 커스터마이징 앱 (React Native + Expo)

## 프로젝트 구조

```
gromo/
  app/    # React Native 앱 (Expo)
  back/   # Spring Boot 백엔드
```

---

## 시작하기 (앱)

### 사전 준비

- [Node.js 18+](https://nodejs.org)
- Android Studio 또는 Xcode (에뮬레이터/시뮬레이터)
- 또는 실기기 + [Expo Dev Client](https://docs.expo.dev/develop/development-builds/introduction/)

> **Expo Go는 지원하지 않습니다.**  
> 카카오 로그인에 네이티브 모듈(`@react-native-seoul/kakao-login`)이 필요해서  
> Expo Go로는 실행이 안 돼요. Development Build를 사용해야 합니다.

### 설치 및 실행

```bash
cd app
npm install
```

**Development Build 생성 (최초 1회)**

```bash
# Android
npx expo run:android

# iOS
npx expo run:ios
```

빌드 후에는 아래 명령어로 개발 서버만 띄우면 됩니다.

```bash
npm start
```

---

## 로그인

카카오 로그인이 적용되어 있어요.  
카카오 개발자 콘솔에서 앱 키를 발급받아 설정 파일에 추가해야 합니다.

---

## 자주 쓰는 명령어

| 명령어                 | 설명                               |
| ---------------------- | ---------------------------------- |
| `npm start`            | Expo 개발 서버 시작 (Dev Client용) |
| `npx expo run:android` | Android 네이티브 빌드 + 실행       |
| `npx expo run:ios`     | iOS 네이티브 빌드 + 실행           |

---

## 기술 스택

- React Native 0.81
- Expo SDK 54
- React Navigation (Bottom Tabs)
- @react-native-seoul/kakao-login
