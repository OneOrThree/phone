# Gromo 프로젝트 초기 세팅 가이드

이 문서는 프로젝트 개발 환경을 구성하는 방법을 설명합니다.

---

## 📋 시스템 요구사항

### 필수

| 항목          | 버전        | 확인 명령어              |
| ------------- | ----------- | ------------------------ |
| **Node.js**   | `24.x` 이상 | `node --version`         |
| **npm**       | `10.x` 이상 | `npm --version`          |
| **Xcode**     | `15.0` 이상 | `xcode-select --version` |
| **CocoaPods** | `1.14` 이상 | `pod --version`          |
| **macOS**     | `13.0` 이상 | `sw_vers`                |

### 선택

- **iOS 시뮬레이터** (개발 용이)
- **실기기** (p12 인증서로 서명)
- **Docker / Docker Compose** — 로컬 백엔드(`server/data-api/`)를 직접 띄울 때만 필요 (`docker --version`, `docker compose version`)
- **Ruby bundler + fastlane** — TestFlight 배포 시에만 필요 (아래 "TestFlight 배포" 참고, `app/app-dev/ios/Gemfile`로 설치)

---

## 🚀 1단계: 시스템 환경 설정

### 1.1 Xcode 명령어 도구 설치

```bash
xcode-select --install
```

또는 App Store에서 Xcode 전체 설치.

### 1.2 CocoaPods 설치

```bash
sudo gem install cocoapods
pod setup  # 처음 한 번만
```

**Ruby 버전 확인** (macOS 기본값 보통 OK):

```bash
ruby --version  # 2.7.0 이상
```

### 1.3 Node.js 설치 (없으면)

```bash
# Homebrew 사용
brew install node@24

# 또는 nvm 사용
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 24
nvm use 24
```

**버전 확인**:

```bash
node --version  # v24.x 이상
npm --version   # 10.9.8 이상
```

---

## 📥 2단계: 프로젝트 다운로드 & 의존성 설치

### 2.1 리포지토리 클론

```bash
git clone <repo-url>
cd Gromo
```

### 2.2 JavaScript 의존성 설치

```bash
cd app/app-dev
npm install
```

**결과**: `node_modules/` 폴더 생성, `package-lock.json` 업데이트

### 2.3 iOS 네이티브 의존성 설치

```bash
cd ios
pod install --repo-update
cd ..
```

**결과**: `Pods/` 폴더 생성, `Podfile.lock` 생성

---

## ⚙️ 3단계: 개발 환경 설정

### 3.1 환경 변수 설정

**`app/app-dev/.env` 파일 생성** (`.gitignore`에 포함된 개인 설정 파일이라 새로 받으면 직접 만들어야 합니다):

```bash
cp app/app-dev/.env.example app/app-dev/.env
```

> `app/app-dev/.env.example`의 기본값은 팀 서버(`https://oneorthree.dev.mooo.com`)를 가리키며 `src/services/api.ts`의 기본값과 동일합니다. 백엔드를 직접 띄우지 않아도 바로 개발을 시작할 수 있습니다 (아래 3.2의 (A) 방식).

### 3.2 백엔드 연결 모드 선택

앱은 백엔드 API 서버(`server/data-api/`, Spring Boot)와 통신합니다. 아래 두 가지 중 하나를 선택하세요.

#### (A) 팀 서버 연결 — 기본, 추천

`app/app-dev/.env`의 `EXPO_PUBLIC_API_URL`을 팀 서버로 설정 (3.1 참고):

```
EXPO_PUBLIC_API_URL=https://oneorthree.dev.mooo.com
```

백엔드를 따로 설치/실행할 필요가 없습니다. 화면/UI 작업은 대부분 이 방식으로 충분합니다.

#### (B) 로컬 백엔드 직접 실행 — 백엔드 코드를 수정/디버깅할 때

백엔드(`server/data-api/`)는 Spring Boot(Java 17) + PostgreSQL이며, `server/scripts/`의 Docker Compose로 실행합니다.

```bash
# 프로젝트 루트에서 — compose 파일이 server/scripts/로 옮겨져 .env 자동 로딩이 안 되므로 --env-file 명시
docker compose --env-file .env -f server/scripts/docker-compose.dev.yml up -d
```

- API 서버: `http://localhost:8080`
- 루트 `.env` 파일에 `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `JWT_SECRET` 값이 필요합니다 (이미 존재).
- 종료: `docker compose --env-file .env -f server/scripts/docker-compose.dev.yml down`

**iOS 시뮬레이터**에서는 `app/app-dev/.env`를 아래처럼 설정:

```
EXPO_PUBLIC_API_URL=http://localhost:8080
REACT_NATIVE_PACKAGER_HOSTNAME=localhost
```

**실기기**에서 연결하려면 Mac의 로컬 IP로 설정해야 합니다:

```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
# 결과 예: inet 172.16.102.49 ...
```

```
EXPO_PUBLIC_API_URL=http://172.16.102.49:8080
REACT_NATIVE_PACKAGER_HOSTNAME=172.16.102.49
```

> ⚠️ 이 IP는 맥북마다 다릅니다. 기존 `.env`에 남아있던 IP는 다른 개발자의 맥북 주소이므로 그대로 사용하면 안 됩니다.

---

## 🏗️ 4단계: 빌드 및 실행

### 4.1 iOS 시뮬레이터 (권장 - 가장 쉬움)

```bash
cd app/app-dev
npm start
# 터미널에서 'i' 입력 또는 다음 명령어 사용:
npx expo run:ios
```

**결과**: iOS 시뮬레이터 자동 실행, 앱 설치 및 실행

### 4.2 실기기 (USB 연결)

**전제조건**:

- iPhone과 Mac이 같은 Wi-Fi 연결
- USB로 기기 연결
- 애플 개발자 계정 (signing certificate 필요)

**단계**:

```bash
cd app/app-dev
npm start  # 별도 터미널 탭에서 계속 실행

# 다른 터미널에서
open ios/gromo.xcworkspace
```

Xcode에서:

1. 좌상단 Device 셀렉터 → 자신의 iPhone 선택
2. **Product → Run** (Cmd+R) 클릭
3. 또는 `npx expo run:ios --device` 사용

### 4.3 Android (미지원)

현재 Android는 스크린 타임 기능이 미지원입니다.

---

## 🛫 TestFlight 배포 (로컬 fastlane)

> **왜 로컬 fastlane?** EAS Build 무료 한도(월 ~15회)를 다 태워서, EAS 대신 **수빈 맥에서 로컬 fastlane**으로 TestFlight에 올린다(무료·무제한). 빌드 머신 = 수빈 맥.

한 방 배포는 `app/app-dev/ios/testflight.sh` 하나면 된다. 아래 **5.1 최초 셋업은 처음 한 번만**, 이후엔 **5.2만 반복**한다.

### 5.1 최초 1회 셋업

#### (1) Ruby 의존성 설치 (fastlane)

fastlane은 `app/app-dev/ios/Gemfile`로 관리하며 `vendor/bundle`에 설치된다 (`.bundle/config`의 `BUNDLE_PATH`).

```bash
cd app/app-dev/ios
gem install bundler              # 없으면
bundle install                   # Gemfile 의존성(fastlane) 설치 → vendor/bundle
bundle exec fastlane --version   # 설치 확인
```

#### (2) App Store Connect API Key(.p8) 발급

Apple ID 비번 대신 API Key로 인증한다 (2FA·세션 만료 없음).

1. App Store Connect → **사용자 및 액세스 → 통합(Integrations) → App Store Connect API**
2. 키 생성 (역할 **App Manager** 이상) → `AuthKey_XXXXXX.p8` 다운로드 (**재발급 불가, 잘 보관**)
3. 같은 화면 상단의 **Issuer ID**(UUID) 복사

#### (3) `app/app-dev/ios/fastlane/.env` 작성 (`.gitignore`됨 — 커밋 금지)

```
ASC_KEY_ID=XXXXXXXXXX             # .p8 파일명의 키 ID (AuthKey_XXXX 의 XXXX)
ASC_ISSUER_ID=c8f76ca4-...        # (2)에서 복사한 Issuer ID
ASC_KEY_PATH=/절대/경로/AuthKey_XXXXXX.p8
```

> 참고값: ASC 앱 id `6774498679`, Issuer `c8f76ca4-9f91-45d9-ad10-76f014ceb3f0`. 이 값들은 `fastlane/Fastfile`의 `app_store_connect_api_key(...)`가 읽는다.

#### (4) 서명(수동) — 배포용 인증서 + 프로비저닝 프로파일

- Apple Developer 계정은 **재영 개인 계정**(Team `P6Z68QUK9M`). 수빈은 재영에게 받은 **distribution p12**로 서명한다.
- **7개 타겟** 각각 `distribution-gromo-*` 프로파일이 필요: 앱 본체 + `screentimemonitor` / `screentimereport` / `notificationservice` / `shieldconfiguration` / `shieldaction` / `widget`.
- 프로파일 이름은 `gromo.xcodeproj`의 `PROVISIONING_PROFILE_SPECIFIER`, 그리고 `fastlane/Fastfile`의 `DIST_PROFILES` 매핑과 **정확히 일치**해야 한다.
- p12(`.p12`)는 더블클릭으로 키체인에 설치, 프로파일(`.mobileprovision`)도 더블클릭으로 설치.
- 자세한 서명/프로파일 발급 흐름은 [CLAUDE.md](./CLAUDE.md)의 "On-device signing / provisioning" 참고.

#### (5) Firebase 설정 파일(plist) 배치 — 없으면 빌드가 멈춘다

`app/app-dev/ios/`에 **두 파일 다** 두어야 한다 (`.gitignore` — git이 아닌 별도 채널로 재영에게 받는다):

| 파일                            | Firebase 프로젝트 | 쓰이는 때                           |
| ------------------------------- | ----------------- | ----------------------------------- |
| `GoogleService-Info-dev.plist`  | `gromo-dev-de87e` | Xcode 로컬 빌드 · `./testflight.sh` |
| `GoogleService-Info-prod.plist` | prod 파베         | `./testflight.sh release`           |

빌드 페이즈("Firebase 환경별 plist 주입")가 **`APP_ENV`(없으면 `EXPO_PUBLIC_ENV`, 그래도 없으면 `dev`)** 를 보고 둘 중 하나를 앱 번들의 `GoogleService-Info.plist`로 복사한다 — 안드로이드 `build.gradle`과 같은 기준이다. 해당 파일이 없으면 `error: Firebase plist 없음`으로 빌드가 실패한다.

> ⚠️ **서버와 Firebase는 같은 환경끼리 붙어야 한다.** dev 서버에 붙은 앱이 prod 파베 토큰을 들고 있으면 푸시가 전부 `SENDER_ID_MISMATCH`로 실패한다. `testflight.sh`가 두 축을 함께 맞춰주므로, 수동 `xcodebuild`로 릴리즈를 만들 때만 `APP_ENV`를 직접 지정하면 된다.

#### (6) (선택) alias 등록 — 어디서든 `testflight`

```bash
echo 'alias testflight="/Users/soobin/phone/app/app-dev/ios/testflight.sh"' >> ~/.zshrc
source ~/.zshrc
```

### 5.2 배포 실행 (매번)

```bash
cd app/app-dev/ios
./testflight.sh        # alias 등록했으면 어디서든 `testflight`
```

`testflight.sh`가 하는 일:

1. **API 서버 강제** — 레인별 기본값을 셸에 export한다: `beta`(테스트 업로드) → dev 서버(`https://oneorthree.dev.mooo.com`), `release`(심사 제출) → prod 서버(`https://api.oneorthree.world`). export한 `EXPO_PUBLIC_API_URL`이 로컬 `.env`/`.env.production`보다 우선하므로 **개발용 로컬 백엔드 주소가 릴리즈 번들에 박히는 사고를 막는다**. 특정 서버로 강제하려면 `TESTFLIGHT_API_URL=<주소> ./testflight.sh [레인]`.
2. **환경 축 정렬** — `EXPO_PUBLIC_ENV`(Sentry·GA4·Datadog 태그)와 `APP_ENV`(Firebase plist 선택)를 하나의 값으로 함께 export한다. 즉 **서버·관측 태그·파베가 항상 한 환경으로 묶인다**. 결정 우선순위는 `TESTFLIGHT_ENV` 명시 > API 주소 매칭(대소문자·끝 슬래시 정규화 후 비교) > `dev`(로컬 백엔드 등 그 외 전부). 서버는 그대로 두고 환경 축만 바꾸려면 `TESTFLIGHT_ENV=prod ./testflight.sh`.
3. **Pods 동기화** — `Podfile.lock`↔`Pods/Manifest.lock`이 어긋날 때만 `pod install` (평소엔 건너뜀).
4. **`bundle exec fastlane <레인>`** 실행 → 빌드번호 갱신 → archive(`.ipa`) → TestFlight 업로드.

`fastlane beta` 레인(`fastlane/Fastfile`) 상세:

- **빌드번호 = 현재 유닉스 타임스탬프**(`Time.now.to_i`). 매번 단조 증가라 "already used"(-19232) 충돌이 원천 차단된다. (과거 "ASC 최신 빌드 +1" 방식은 `MARKETING_VERSION` 리터럴 + `expo prebuild`의 버전 리셋 때문에 계속 충돌했음.)
- **archive** — workspace `gromo.xcworkspace`, scheme `gromo`, `Release`, `app-store` export, **수동 서명**(`DIST_PROFILES`).
- **업로드** — `skip_waiting_for_build_processing: true` (ASC 처리 완료까지 대기 안 함). 업로드 후 App Store Connect에서 처리(수 분)가 끝나면 TestFlight에 노출된다.

### 5.3 배포 트러블슈팅 (자주 막히는 곳)

- **codesign `errSecInternalComponent`** = 키체인이 distribution 개인키에 접근하지 못함.
  키체인 접근 앱 → "Apple Distribution: jaeyoung jo" **개인키** → 정보(⌘I) → **접근 제어** → "모든 응용 프로그램이 이 항목에 접근하도록 허용". 또는 CLI로:
  ```bash
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k <login-비번> ~/Library/Keychains/login.keychain-db
  ```
- **"sandbox is not in sync with the `Podfile.lock`"** = 브랜치 전환/라이브러리 추가 후 `pod install`을 안 함. `testflight.sh`가 자동 처리하지만, 수동으로 돌릴 땐 `pod install` 후 `Pod installation complete!`를 확인.
- **`react-native-fbsdk-next` throw** = `app.config.js`가 `EXPO_PUBLIC_FACEBOOK_APP_ID`가 없으면 플러그인에서 throw. appID가 있을 때만 플러그인을 추가하도록 조건부 처리돼 있어(없어도 빌드는 됨), 값이 비어도 배포는 진행된다.
- **`.env`가 Release 번들에 인라인됨** = Expo는 빌드 시점의 `EXPO_PUBLIC_*` 값을 번들에 그대로 박는다. `testflight.sh`는 export로 프로덕션 서버를 강제하니 안전하지만, **`fastlane beta`를 직접 돌릴 땐** `app/app-dev/.env.production`의 `EXPO_PUBLIC_API_URL`이 프로덕션 서버인지 반드시 확인. 업로드 전 `strings <archive>/Products/Applications/gromo.app/main.jsbundle | grep -o 'https://[a-z.]*oneorthree[a-z.]*' | sort -u`로 번들에 박힌 주소를 직접 검증할 수 있다.
- **`node: command not found`**(비대화형/일부 셸) = `testflight.sh`가 `/opt/homebrew/Cellar/node@24/...`를 PATH에 보강해 둠. node 버전이 바뀌면 스크립트 안의 경로도 같이 갱신할 것.

---

## 📂 프로젝트 구조

> 코드는 전부 **TypeScript**, 소스는 `app/app-dev/src/` 아래에 있고 `@/` 별칭(`@` = `src`)으로 임포트한다. 화면/컴포넌트/상태 규칙의 정본은 [CLAUDE.md](./CLAUDE.md) "Project structure" 참고.

```
Gromo/
├── app/app-dev/                  # React Native + Expo 앱 (TypeScript)
│   ├── package.json              # JS 의존성
│   ├── app.config.js             # Expo 설정 (플러그인·assets)
│   ├── .env                      # 환경 변수 (개인 설정, gitignore)
│   ├── index.ts                  # 진입점 → ./src/App
│   ├── src/
│   │   ├── App.tsx               # 인증 게이팅 + Provider + <RootNavigator/>
│   │   ├── screens/              # 화면 (Homescreen.tsx 등)
│   │   ├── components/           # 재사용 UI
│   │   ├── navigation/           # RootNavigator.tsx
│   │   ├── store/                # 전역 상태 (Context API)
│   │   ├── services/             # api.ts(axios), ScreenTimeModule.ts
│   │   ├── constants/            # theme.ts (디자인 토큰)
│   │   ├── utils/ types/ hooks/ assets/
│   ├── ios/                      # iOS 네이티브 코드
│   │   ├── gromo.xcworkspace     # Xcode 워크스페이스 (열기)
│   │   ├── gromo/                # 메인 앱 타겟 (ScreenTimeModule.swift, *.entitlements, AppDelegate.swift)
│   │   ├── screentimereport/     # 스크린 타임 리포트 익스텐션 (TotalActivityReport/View.swift)
│   │   ├── Gemfile               # fastlane 등 Ruby 의존성
│   │   ├── testflight.sh         # TestFlight 한 방 배포 스크립트
│   │   ├── fastlane/             # Fastfile · Appfile · .env(gitignore)
│   │   └── Pods/                 # CocoaPods 의존성 (자동 생성)
│   └── .claude/
│       ├── DevRunbook.md         # 이 파일 (환경 세팅 + 배포)
│       ├── CLAUDE.md             # 프론트엔드 코드 규칙
│       └── *_WorkLog.md          # 기능별 작업 로그 (ScreenTime 등)
│
└── server/data-api/              # Spring Boot 백엔드 (이 리포에 포함)
    └── ...
```

---

## 🔍 5단계: 검증 체크리스트

시작 전 다음을 확인하세요:

### 필수 설치

- [ ] Node.js v24+: `node --version`
- [ ] npm 10+: `npm --version`
- [ ] Xcode 명령어 도구: `xcode-select --install`
- [ ] CocoaPods: `pod --version`

### 프로젝트 설정

- [ ] `app/app-dev/node_modules/` 존재 (`npm install` 완료)
- [ ] `app/app-dev/ios/Pods/` 존재 (`pod install` 완료)
- [ ] `app/app-dev/.env` 파일 생성 및 `EXPO_PUBLIC_API_URL` 설정 확인 (팀 서버 또는 로컬 백엔드)
- [ ] (B) 로컬 백엔드 선택 시: `docker compose --env-file .env -f server/scripts/docker-compose.dev.yml ps`로 컨테이너 정상 동작 확인

### 빌드 준비

- [ ] `app/app-dev/.env`의 `EXPO_PUBLIC_API_URL` 올바른지 확인
- [ ] Metro가 실행 가능한지 확인:
  ```bash
  cd app/app-dev && npm start
  # 출력: "Metro waiting on exp://..."
  ```

---

## 🐛 문제 해결

### "Metro waiting..." 메시지가 안 뜨고 앱이 실행 안 됨

```bash
# 캐시 초기화 후 재시작
cd app/app-dev
rm -rf node_modules package-lock.json
npm install
npm start --clear
```

### Pod 관련 에러

```bash
cd app/app-dev/ios
rm -rf Pods Podfile.lock
pod install --repo-update
cd ../..
npm start
```

### Xcode에서 "Header not found" 에러

```bash
cd app/app-dev/ios
xcodebuild clean
pod install --repo-update
cd ..
npx expo run:ios
```

### 실기기에서 "No script URL" 에러

- [ ] iPhone과 Mac이 **같은 Wi-Fi**에 연결되어 있나?
- [ ] `.env`의 IP 주소가 `ifconfig`의 결과와 일치하나?
- [ ] Mac 방화벽에서 포트 8081이 열려있나?
  ```bash
  lsof -i :8081  # 프로세스 있으면 OK
  ```

---

## 📝 유용한 npm 스크립트

| 명령어                 | 용도                               |
| ---------------------- | ---------------------------------- |
| `npm start`            | Metro 번들러 시작 (`expo start`)   |
| `npm run ios`          | iOS 시뮬레이터 빌드 & 실행         |
| `npm run typecheck`    | `tsc --noEmit` 타입 검사 (CI 포함) |
| `npm run lint`         | ESLint 검사                        |
| `npm run lint:fix`     | ESLint 자동 수정                   |
| `npm run format:check` | Prettier 검사                      |
| `npm run format:fix`   | Prettier 자동 포맷                 |

---

## 🔐 Apple Developer 계정 설정 (실기기 테스트)

실기기에서 테스트하려면:

1. **Apple Developer 계정** 필요 (또는 팀 관리자에게 p12 인증서 받기)
2. **Provisioning Profile** 설치
3. Xcode에서 Signing 설정:
   - Product → Scheme → Edit Scheme
   - Build 탭 → Code Sign Identity 설정

자세한 서명/프로파일 흐름은 [CLAUDE.md](./CLAUDE.md)의 "On-device signing / provisioning" 섹션 참고. TestFlight 배포용 서명은 위 "TestFlight 배포 (로컬 fastlane)" 5.1-(4) 참고.

---

## 📚 다음 단계

1. **코드 규칙**: [CLAUDE.md](./CLAUDE.md) 읽기
2. **스크린 타임 통합**: [ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md)
3. **TestFlight 배포**: 위 "TestFlight 배포 (로컬 fastlane)" 섹션

---

## 💬 도움말

문제가 생기면:

1. 이 파일의 "문제 해결" / "배포 트러블슈팅" 섹션 확인
2. [CLAUDE.md](./CLAUDE.md)의 "Troubleshooting" 섹션 확인
3. 팀 리더에게 문의

---

**최종 업데이트**: 2026-08-26 (디렉토리 구조 개편 — `app/` → `app/app-dev/`, `back/` → `server/data-api/`, compose → `server/scripts/`)
