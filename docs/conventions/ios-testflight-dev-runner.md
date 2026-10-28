# iOS dev TestFlight 자동 빌드 — 내 맥을 러너로 등록하기

main에 `app/app-dev/**` 변경이 머지되면, **머지 버튼을 누른 사람의 맥**에서 dev 서버용 TestFlight 빌드가 자동으로 올라간다(워크플로 `iOS TestFlight (dev)`, 티켓 2219). 그러려면 각자 맥이 레포의 GitHub Actions 러너로 등록돼 있어야 한다. 이 문서는 그 등록 절차와 알아둘 점이다.

## 왜 이렇게 하나

- iOS 빌드는 Xcode가 있는 맥에서만 된다. 지금 레포에 등록된 러너는 GCP 리눅스 2대라 못 한다.
- GitHub이 빌려주는 macOS 러너는 비공개 레포 기준 리눅스의 10배 요금이고, 매번 빈 컴퓨터라 인증서·키를 다시 넣어야 한다.
- 각자 맥은 이미 Xcode와 서명 환경이 있다. 러너 라벨에 깃허브 아이디를 붙여 두면 워크플로가 `github.actor`(머지한 사람)로 그 맥을 고른다.

## 한 번만 하면 되는 것

1. **준비물**: `gh` 로그인(`gh auth login`), 레포 **admin** 권한(러너 등록 토큰 발급과 러너 목록 조회가 admin 전용 API다 — 없으면 안수빈에게 요청), Xcode, Homebrew의 `cocoapods`·`ruby`(bundler). 러너는 등록할 때의 셸 PATH를 저장해 쓰므로 **이 도구들이 보이는 터미널에서** 등록한다. Node는 워크플로가 `actions/setup-node`로 앱 CI와 같은 24를 직접 깔아 쓰므로 맥에 있는 버전과 무관하다.
2. **받을 것 (안수빈에게)**: App Store Connect API 키 `.p8` 파일, Key ID, Issuer ID. `.p8`은 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`에 두고 `chmod 600`. 메신저에 그냥 붙이지 말고 AirDrop이나 비밀번호 걸린 압축으로 — 다시 내려받을 수 없는 파일이라 새면 키를 폐기해야 한다. 그 밖의 설정(약관 버전, Datadog, fastlane 설정)은 전부 레포에 있어 받을 것이 없다. 푸시 설정 파일만 예외다(아래 「푸시 설정 파일」).
3. **등록 스크립트** (레포 체크아웃에서):
   ```sh
   .github/scripts/register-mac-runner.sh
   ```
   러너를 `~/actions-runner`에 내려받고(릴리스 노트의 sha256과 대조), 라벨 `macOS, ios, <내 깃허브 아이디>`로 레포에 등록하고, ASC 값을 물어 `~/actions-runner/.env`에 적고, 로그인 시 자동 시작 서비스로 띄운 뒤, 레포 변수 `IOS_DEV_RUNNERS`에 내 아이디를 덧붙인다(아래 "러너 선택" 참고). 처음 실행할 때 macOS가 허용 창을 띄우면 허용한다. 다시 실행해도 안전하다 — 이미 된 단계는 건너뛰고, `.env`를 새로 적었거나 서비스가 멈춰 있으면 (재)시작한다.
4. **서명 키 접근 허용 (한 번)**: 러너는 백그라운드 서비스라 macOS의 "codesign이 키를 쓰려고 합니다" 창을 띄울 수 없고, 그대로 두면 아카이브가 `errSecInternalComponent`로 실패한다. 터미널에서 아래를 치고 맥 비밀번호를 넣는다. 등록 스크립트 마지막에도 같은 명령을 실행한다.
   ```sh
   security set-key-partition-list -S apple-tool:,apple:,codesign: -s ~/Library/Keychains/login.keychain-db
   ```
   등록 스크립트는 러너 서비스 설정에서 `SessionCreate`도 뺀다. 이 항목이 켜져 있으면 러너가 로그인 세션과 분리된 세션에서 떠서 위 명령을 쳐도 서명이 실패한다(오너 맥에서 실제로 겪음).
   서명 인증서(`Apple Development`·`Apple Distribution`, 팀 P6Z68QUK9M)가 키체인에 없으면 Xcode가 API 키로 자동 발급하는지 첫 실행에서 드러난다. 안 되면 조재영 맥의 키체인 접근에서 인증서를 `.p12`로 내보내 가져온다.
5. **잠자기 방지**: 시스템 설정 → 배터리 → 옵션 → "전원 어댑터 연결 시 자동으로 잠자기 방지". 잠든 맥은 일을 못 받는다. 머지할 때마다 맥이 켜져 있다면 생략해도 된다. 재부팅한 뒤에는 **로그인해야** 러너가 다시 뜬다(로그인 세션 안에서 도는 서비스라서 — 그래야 키체인도 쓴다).
6. **확인**: 레포 Settings → Actions → Runners에 내 맥이 **Idle**로 보이는지. 그다음 Actions → `iOS TestFlight (dev)` → Run workflow로 내 맥에서 끝까지 도는지 한 번 본다. 처음 실행은 `npm ci`·`pod install`까지 해서 30분쯤 걸릴 수 있다.

## 빌드가 어떻게 도는가

- 트리거: `main` push 중 `app/app-dev/**` 변경, 또는 수동 실행. **PR에서는 돌지 않는다**(아래 "공개 레포" 참고).
- 러너 선택: `runs-on: [self-hosted, macOS, ios, <github.actor>]`. 단, 머지한 사람이 레포 변수 **`IOS_DEV_RUNNERS`**(러너를 등록한 깃허브 아이디의 쉼표 목록, 공백 없이 — 예 `flying-adventure,joejaeyoung`)에 없으면 **러너 배정 전에 빌드를 건너뛴다**. 변수가 없거나 비어 있어도 자동 빌드를 하지 않는다(워크플로의 `GITHUB_TOKEN`으로는 러너 목록 API를 못 읽어 변수로 판단한다). 등록 스크립트가 러너가 **online**으로 보인 뒤에 변수에 아이디를 덧붙이므로 직접 만질 일은 없다. 수동 실행은 **목록과 관계없이 항상 누른 사람의 맥**에서 돈다 — 아무 브랜치나 고를 수 있는 수동 실행이 남의 맥으로 가면 안 되기 때문이다. 러너를 등록하지 않은 사람이 누르면 그냥 대기한다. 다른 사람 맥에서 돌리고 싶으면 그 사람이 직접 Run workflow를 누른다 — 남의 맥을 고르는 입력란은 일부러 두지 않았다(수동 실행은 아무 브랜치에서나 할 수 있어서, 검토 안 된 코드를 남의 맥에서 돌리는 길이 된다).
- 하는 일: `setup-node`(Node 24) → `npm ci` → `app/app-dev/ios/testflight.sh --dev` (티켓 2218). 스크립트가 Pods 동기화, fastlane 설치, dev 서버 주소 고정, archive, TestFlight 업로드까지 한다. 테스트 노트 첫 줄에 `dev 서버(oneorthree.dev.mooo.com) 빌드 — <commit>`이 붙는다.
- 값의 출처: ASC 키(비밀값)는 각자 맥의 `~/actions-runner/.env`. 약관 버전·Datadog 같은 공개 설정은 레포의 `app/app-dev/ios/release-config.sh`라 따로 넣을 것이 없다. Firebase 설정 파일은 `.env`의 `GROMO_IOS_CREDENTIALS_DIR`가 가리키는 레포 밖 디렉터리(아래 「푸시 설정 파일」).
- 동시 실행은 하나로 제한된다(빌드 번호는 TestFlight 최신 + 1이라 겹치면 안 된다). 연달아 머지되면 뒤 것들이 순서대로 기다린다(`queue: max` — 기본값은 대기 중인 실행을 하나만 남기고 취소한다).
- 고른 맥이 꺼져 있으면 잡이 "대기 중"으로 남았다가 맥이 켜지면 돈다. `IOS_DEV_RUNNERS`에 없는 사람이나 봇이 머지하면 빌드를 건너뛴다. 자동 빌드를 중단하려면 목록에서 내 아이디를 빼고, 마지막 항목이면 변수를 삭제한다. 러너를 유지하면 수동 실행은 계속 쓸 수 있다. 24시간 안에 러너가 안 잡히면 GitHub이 잡을 실패 처리한다.

## 푸시 설정 파일 `GoogleService-Info.plist` (GROMO-2523)

2.0 iOS 빌드는 서버 환경별 Firebase 설정 파일을 앱에 넣는다(Xcode 빌드 단계 `[Firebase] Copy GoogleService-Info.plist` → `app/app-dev/scripts/firebase-plist-xcode.sh`). 파일은 레포에 없으니 러너 맥마다 한 번 둔다.

- **레포 밖** 디렉터리 하나에 `dev/GoogleService-Info.plist`·`prod/GoogleService-Info.plist`를 둔다(예 `/Users/<나>/.gromo/ios-credentials/dev/GoogleService-Info.plist`). 러너는 실행마다 체크아웃을 정리하면서 레포 안의 무시된 파일까지 지우므로 `app/app-dev/ios/credentials/`에 두면 사라진다. 파일은 Firebase 콘솔(iOS 앱 `com.oneorthree.focuscat`)에서 받거나 조재영에게 받는다.
- `~/actions-runner/.env`에 `GROMO_IOS_CREDENTIALS_DIR=<그 디렉터리의 절대 경로>` 한 줄을 넣고 `./svc.sh stop && ./svc.sh start`(서비스는 시작할 때 .env를 읽는다). 등록 스크립트가 ASC 값을 물어 `.env`를 새로 적으면 이 줄도 지워지니 다시 넣는다.
- **GROMO-2518 에픽이 main에 머지된 뒤 이 설정이 없는 맥의 dev TestFlight 빌드는 실패한다.** Release 빌드는 plist가 없거나 `BUNDLE_ID`·`PROJECT_ID`가 맞지 않으면(`app/app-dev/ios/release-config.sh`의 `GROMO_FIREBASE_PROJECT_ID_*`) 막는다 — 푸시를 못 받는 빌드가 조용히 올라가지 않게 하는 의도된 차단이다.

## 한 번만 자동 업로드 건너뛰기

해당 PR 제목에 `[skip testflight]`를 붙이고 **최종 머지 커밋 메시지에도 이 표시를 유지**한다. main push의 마지막 커밋 메시지에 표시가 있으면 TestFlight 잡만 러너 배정 전에 건너뛴다. 앱·서버 CI는 그대로 실행되며, 표시가 없는 다음 main push와 수동 실행은 정상적으로 빌드한다. 워크플로 자체를 비활성화하거나 `[skip ci]`를 쓰지 않는다.

스쿼시 머지에서는 PR 제목이 커밋 제목으로 들어간다. 머지 메시지를 직접 고치거나 rebase merge를 쓸 경우에도 main에 들어갈 마지막 커밋의 표시를 확인한다. 이번 배포를 건너뛰는 PR의 커밋을 되돌리며 그 제목을 인용하면 표시도 따라갈 수 있으므로, 되돌리기 빌드를 올려야 할 때는 메시지에서 표시를 뺀다.

## 공개 레포라서 지키는 것

이 레포는 공개 레포다. 개인 맥 러너에서 도는 워크플로에 `pull_request`나 `pull_request_target` 트리거를 **절대 추가하지 않는다** — 외부인이 보낸 PR의 코드가 팀원 맥에서 실행된다. 레포 설정(Actions → General)에서 외부 기여자의 워크플로 실행은 전부 승인 필요로 돼 있다. 새 워크플로를 만들 때 self-hosted 맥 라벨을 쓰려면 같은 원칙을 따른다.

신뢰 경계는 **레포 쓰기 권한**이다. 쓰기 권한이 있으면 자기 브랜치에 `on: push` 워크플로를 올려 어떤 라벨의 러너에서든 코드를 돌릴 수 있고, 이건 워크플로 파일 안의 `if`나 트리거 조정으로 막을 수 없다(GitHub이 self-hosted 러너에 대해 문서화한 전제다). 그래서 이 레포의 쓰기 권한은 팀원에게만 있고, 러너 라벨은 admin만 붙일 수 있으며, 러너 맥의 ASC 키는 App Manager 역할로 제한한다. 계정이 탈취된 것 같으면 그 사람의 쓰기 권한을 먼저 끊고 ASC 키를 폐기한다.

## 자주 걸리는 것

| 증상 | 원인 · 조치 |
|---|---|
| 잡이 계속 "Queued" | 잡 이름에 적힌 라벨의 러너가 오프라인(잠듦·재부팅 후 미로그인)이거나, `IOS_DEV_RUNNERS`에는 있는데 실제 러너가 없는 경우. Settings → Runners에서 상태 확인, 맥에서 `~/actions-runner/svc.sh status`. 24시간 지나면 실패로 끝나니 필요하면 Run workflow로 내 맥에서 다시 올린다 |
| 내가 머지했는데 빌드가 건너뛰어짐 | `IOS_DEV_RUNNERS`에 내 아이디가 없거나 `[skip testflight]` 표시가 있다. 자동 빌드를 원하면 러너 등록·온라인 상태를 확인하고 등록 스크립트를 (다시) 돌리면 목록에 덧붙인다 |
| "러너 .env 에 ASC_… 가 없다" | `~/actions-runner/.env`에 세 줄이 있는지 확인하고 `svc.sh stop && svc.sh start` (서비스는 시작할 때 .env를 읽는다) |
| `errSecInternalComponent`로 CodeSign 실패 | 둘 중 하나다. ① 키체인이 백그라운드 서명을 허용하지 않음 → 위 4번 명령. ② 러너 서비스 설정(`~/Library/LaunchAgents/actions.runner.*.plist`)에 `SessionCreate`가 남아 있음 → 러너가 로그인 세션과 분리돼 키체인을 못 쓴다. 등록 스크립트를 다시 돌리면 빼고 재설치한다 |
| 업로드가 "build number already used" 류로 거절됨 | 같은 시간에 누군가 로컬에서 수동 운영 빌드(`testflight.sh`)를 올린 것. 빌드 번호는 `beta`·`beta_dev`가 같은 앱의 TestFlight 최신 + 1을 쓰므로 겹칠 수 있다(`concurrency`는 Actions 안의 실행만 직렬화한다). Run workflow로 다시 올리면 된다 |
| 서명·프로비저닝 실패 | fastlane이 ASC API 키로 프로파일을 받는다. 키의 역할이 App Manager 이상인지, 번들 id `com.oneorthree.focuscat`에 접근 권한이 있는지, 키체인에 팀 인증서가 있는지 확인 |
| `error: iOS release 차단: …/GoogleService-Info.plist 없음` | `~/actions-runner/.env`에 `GROMO_IOS_CREDENTIALS_DIR`가 없거나 그 아래 `dev/`·`prod/` 파일이 없다. 위 「푸시 설정 파일」대로 두고 서비스를 재시작한다 |
| `pod install`에서 죽음 | 맥의 CocoaPods·Ruby 버전. 로컬에서 `cd app/app-dev/ios && pod install`이 되는지 먼저 본다 |
| 링크 에러 `Sealable` 또는 즉시 크래시 | `ios/Pods`의 미리 빌드된 프레임워크 Debug/Release 표시가 어긋난 것. 러너 작업 폴더(`~/actions-runner/_work`)는 개발 폴더와 분리돼 있으니 그 안의 Pods를 지우고 다시 돌린다 |

러너를 빼려면 `~/actions-runner`에서 `./svc.sh stop && ./svc.sh uninstall && ./config.sh remove`, 그리고 레포 변수 `IOS_DEV_RUNNERS`에서 내 아이디를 뺀다(`gh variable set IOS_DEV_RUNNERS --repo OneOrThree/phone --body <나를 뺀 목록>`). 마지막 항목이면 `gh variable delete IOS_DEV_RUNNERS --repo OneOrThree/phone`으로 변수를 삭제한다. 목록에서 안 빼면 내가 머지한 빌드가 없는 러너를 기다린다.
