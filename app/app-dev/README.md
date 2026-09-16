# GROMO 2.0 앱

GROMO 2.0의 활성 React Native·Expo 앱입니다. 세로·가로 레이아웃과 iOS·Android·웹을 지원하며, 현재 제품 흐름은 로컬 목업 상태와 저장소를 사용합니다.

## 로컬 실행

```sh
npm ci
npm start
```

Expo 개발 서버에서 플랫폼을 선택하거나 아래 명령으로 바로 실행할 수 있습니다.

```sh
npm run ios
npm run android
npm run web
```

루트의 `RN-앱-열기.command`와 `GROMO-데모.command`는 macOS에서 개발 서버 또는 정적 웹 빌드를 여는 보조 스크립트입니다.

일반 URL은 첫 시작부터 진행합니다. `?demo=1`은 완공된 마을 체험, `?review=1`은 검증 스크립트의 상태 주입용입니다. 두 모드는 기존 로컬 저장을 읽거나 덮어쓰지 않습니다.

## 구조

- `src/App.tsx`: 앱 상태·저장·화면 전환·음원 재생
- `src/screens/`: 섬, 집중, 탐색, 인테리어, 꾸미기, 월드 화면
- `src/components/`: 공용 UI·타이포그래피·캐릭터 컴포넌트
- `src/services/model.ts`: 재화·건설·집중·퀘스트·친구 정책
- `src/hooks/`: 카메라와 사운드 훅
- `src/utils/`: 섬 경로·카메라·월드 그리드 계산
- `src/constants/`: 에셋 레지스트리와 월드·모션 상수
- `src/assets/`: 앱에 번들되는 이미지·폰트·오디오
- `ios/`, `android/`: 가져온 네이티브 프로젝트
- `scripts/`: 화면·사용자 여정 검증 도구. 결과는 gitignored `.docs/`에 생성

## 검증

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npx expo export --platform all
```

웹 상호작용 검증은 정적 빌드를 로컬 서버로 띄운 뒤 실행합니다.

```sh
npm run build:all
python3 -m http.server 18762 --bind 127.0.0.1 --directory dist-all
npm run review:v2
npm run review:v2-journeys
```

## 현재 연결 범위

화면 전환, 로컬 저장, 집중 구간 계산, 공동 재화, 건설 타이머와 음원 재생은 앱 안에서 동작합니다. 인증, 다른 기기의 주민·편지·가입 승인, 서버 랭킹, OS 스크린타임 수집, 푸시와 원격 음악 동기화는 아직 로컬 목업 범위입니다.

앱 버전은 `2.0.0`, iOS·Android 식별자는 `com.gromo.fishcat`입니다. 서버 API와 인증 연결, 스토어 배포 설정은 후속 작업에서 구성합니다.
