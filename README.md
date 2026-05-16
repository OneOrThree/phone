# testapp

React Native + Expo 앱 — `character.glb` 3D 모델 뷰어.

## 1. 사전 준비

- Node.js 18 이상
- (안드로이드) Android Studio + 에뮬레이터 또는 실기기
- (iOS) macOS + Xcode (Windows에서는 EAS Build 또는 Expo Go 사용)

## 2. 설치

```bash
cd C:\dev\testapp
npm install
```

## 3. 실행

### A. 가장 빠른 방법 — Expo Go (제한적, 일단 화면만 띄울 때)
```bash
npm run start:go
```
폰에 **Expo Go** 앱 깔고 QR 코드 스캔.
> 단, `expo-gl` 은 Expo Go 에서도 일부 동작하지만, 3D 가 무거우면 Development Build 권장.

### B. Development Build (3D 안정적으로 띄우려면 권장)

1) EAS CLI 설치 및 로그인 (최초 1회):
```bash
npm install -g eas-cli
eas login
```

2) 프로젝트 초기화 (최초 1회):
```bash
eas init
```

3) 개발 빌드 (안드로이드 APK 예시):
```bash
eas build --profile development --platform android
```
빌드가 끝나면 QR/링크로 APK 다운로드 → 폰에 설치.

4) Metro 서버 켜고 폰에서 앱 열기:
```bash
npm start
```

### C. 로컬 네이티브 빌드 (Android Studio 있을 때)
```bash
npx expo prebuild
npm run android
```

## 4. 캐릭터 파일

- `assets/models/character.glb` 에 모델이 들어 있습니다 (이미 복사 완료).
- 다른 모델로 교체하려면 같은 경로에 같은 이름으로 덮어쓰거나, `App.js` 의 `require('./assets/models/character.glb')` 경로를 수정.

## 5. 조작

- 한 손가락 드래그: 회전
- 두 손가락 핀치: 줌
- 자동 회전 끄려면 `App.js` 의 `useFrame` 블록을 주석 처리.

## 6. 트러블슈팅

| 문제 | 해결 |
|------|------|
| 화면이 까맣게만 보임 | 카메라 거리(`position`)나 모델 `scale`/`position` 조정. 모델이 너무 크거나 멀리 있을 수 있음. |
| `Unable to resolve "./assets/models/character.glb"` | `metro.config.js` 의 `assetExts` 에 `glb` 가 있는지 확인. Metro 캐시 비우기: `npx expo start -c` |
| Expo Go 에서 Three.js 가 안 돌아감 | Development Build 로 전환 (위 B 단계). |
| 모델이 너무 커서 화면 밖으로 나감 | `<Character scale={0.1} />` 처럼 scale 줄이기. |

## 7. 다음 단계

- 애니메이션 재생: `useAnimations` 훅 사용 (`@react-three/drei/native`)
- 환경광 / HDRI 배경: `Environment` 컴포넌트
- 터치 인터랙션: `onPointerDown` 등 R3F 이벤트
