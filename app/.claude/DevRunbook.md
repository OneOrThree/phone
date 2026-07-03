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
- **Docker / Docker Compose** — 로컬 백엔드(`back/`)를 직접 띄울 때만 필요 (`docker --version`, `docker compose version`)

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
cd app
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

**`app/.env` 파일 생성** (`.gitignore`에 포함된 개인 설정 파일이라 새로 받으면 직접 만들어야 합니다):

```bash
cp app/.env.example app/.env
```

> `app/.env.example`의 기본값은 팀 서버(`https://oneorthree.dev.mooo.com`)를 가리키며 `app/utils/api.js`의 기본값과 동일합니다. 백엔드를 직접 띄우지 않아도 바로 개발을 시작할 수 있습니다 (아래 3.2의 (A) 방식).

### 3.2 백엔드 연결 모드 선택

앱은 백엔드 API 서버(`back/`, Spring Boot)와 통신합니다. 아래 두 가지 중 하나를 선택하세요.

#### (A) 팀 서버 연결 — 기본, 추천

`app/.env`의 `EXPO_PUBLIC_API_URL`을 팀 서버로 설정 (3.1 참고):

```
EXPO_PUBLIC_API_URL=https://oneorthree.dev.mooo.com
```

백엔드를 따로 설치/실행할 필요가 없습니다. 화면/UI 작업은 대부분 이 방식으로 충분합니다.

#### (B) 로컬 백엔드 직접 실행 — 백엔드 코드를 수정/디버깅할 때

백엔드(`back/`)는 Spring Boot(Java 17) + PostgreSQL이며, 프로젝트 루트의 Docker Compose로 실행합니다.

```bash
# 프로젝트 루트에서
docker compose -f docker-compose.dev.yml up -d
```

- API 서버: `http://localhost:8080`
- 루트 `.env` 파일에 `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `JWT_SECRET` 값이 필요합니다 (이미 존재).
- 종료: `docker compose -f docker-compose.dev.yml down`

**iOS 시뮬레이터**에서는 `app/.env`를 아래처럼 설정:

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
cd app
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
cd app
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

## 📂 프로젝트 구조

```
Gromo/
├── app/                          # React Native 앱 (메인)
│   ├── package.json              # JavaScript 의존성
│   ├── .env                       # 환경 변수 (개인 설정)
│   ├── App.js                     # 앱 진입점
│   ├── screens/                   # 화면 컴포넌트
│   ├── components/                # UI 컴포넌트
│   ├── utils/                     # 유틸리티 (API, ScreenTimeModule 등)
│   ├── contexts/                  # Context API (전역 상태)
│   ├── ios/                       # iOS 네이티브 코드
│   │   ├── gromo.xcworkspace     # Xcode 워크스페이스 (열기)
│   │   ├── gromo/                 # 메인 앱 타겟
│   │   │   ├── ScreenTimeModule.swift
│   │   │   ├── ScreenTimeModule.m
│   │   │   ├── gromo.entitlements
│   │   │   └── AppDelegate.swift
│   │   ├── screentimereport/      # 스크린 타임 리포트 익스텐션
│   │   │   ├── TotalActivityReport.swift
│   │   │   ├── TotalActivityView.swift
│   │   │   └── screentimereport.entitlements
│   │   └── Pods/                  # CocoaPods 의존성 (자동 생성)
│   └── .claude/
│       ├── SETUP.md               # 이 파일
│       ├── dev-runbook.md         # 개발 가이드
│       └── CLAUDE.md              # 프로젝트 규칙
│
└── back/                          # Spring Boot 백엔드 (이 리포에 포함)
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

- [ ] `app/node_modules/` 존재 (`npm install` 완료)
- [ ] `app/ios/Pods/` 존재 (`pod install` 완료)
- [ ] `app/.env` 파일 생성 및 `EXPO_PUBLIC_API_URL` 설정 확인 (팀 서버 또는 로컬 백엔드)
- [ ] (B) 로컬 백엔드 선택 시: `docker compose -f docker-compose.dev.yml ps`로 컨테이너 정상 동작 확인

### 빌드 준비

- [ ] `app/.env`의 `EXPO_PUBLIC_API_URL` 올바른지 확인
- [ ] Metro가 실행 가능한지 확인:
  ```bash
  cd app && npm start
  # 출력: "Metro waiting on exp://..."
  ```

---

## 🐛 문제 해결

### "Metro waiting..." 메시지가 안 뜨고 앱이 실행 안 됨

```bash
# 캐시 초기화 후 재시작
cd app
rm -rf node_modules package-lock.json
npm install
npm start --clear
```

### Pod 관련 에러

```bash
cd app/ios
rm -rf Pods Podfile.lock
pod install --repo-update
cd ../..
npm start
```

### Xcode에서 "Header not found" 에러

```bash
cd app/ios
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

| 명령어                 | 용도                             |
| ---------------------- | -------------------------------- |
| `npm start`            | Metro 번들러 시작 (`expo start`) |
| `npm run ios`          | iOS 시뮬레이터 빌드 & 실행       |
| `npm run lint`         | ESLint 검사                      |
| `npm run lint:fix`     | ESLint 자동 수정                 |
| `npm run format:check` | Prettier 검사                    |
| `npm run format:fix`   | Prettier 자동 포맷               |

---

## 🔐 Apple Developer 계정 설정 (실기기 테스트)

실기기에서 테스트하려면:

1. **Apple Developer 계정** 필요 (또는 팀 관리자에게 p12 인증서 받기)
2. **Provisioning Profile** 설치
3. Xcode에서 Signing 설정:
   - Product → Scheme → Edit Scheme
   - Build 탭 → Code Sign Identity 설정

자세한 내용은 `DevRunbook.md`의 "Apple Developer 설정" 섹션 참고.

---

## 📚 다음 단계

1. **개발 시작**: `dev-runbook.md` 읽기
2. **코드 규칙**: `CLAUDE.md` 읽기
3. **스크린 타임 통합**: `dev-runbook.md`의 "스크린 타임 통합" 섹션

---

## 💬 도움말

문제가 생기면:

1. 이 파일의 "문제 해결" 섹션 확인
2. `dev-runbook.md`의 트러블슈팅 섹션 확인
3. 팀 리더에게 문의

---

**최종 업데이트**: 2026-06-14
