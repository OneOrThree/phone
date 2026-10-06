# iOS dev TestFlight 자동 빌드 — 내 맥을 러너로 등록하기

main에 `app/app-dev/**` 변경이 머지되면, **머지 버튼을 누른 사람의 맥**에서 dev 서버용 TestFlight 빌드가 자동으로 올라간다(워크플로 `iOS TestFlight (dev)`, 티켓 2219). 그러려면 각자 맥이 레포의 GitHub Actions 러너로 등록돼 있어야 한다. 이 문서는 그 등록 절차와 알아둘 점이다.

## 왜 이렇게 하나

- iOS 빌드는 Xcode가 있는 맥에서만 된다. 지금 레포에 등록된 러너는 GCP 리눅스 2대라 못 한다.
- GitHub이 빌려주는 macOS 러너는 비공개 레포 기준 리눅스의 10배 요금이고, 매번 빈 컴퓨터라 인증서·키를 다시 넣어야 한다.
- 각자 맥은 이미 Xcode와 서명 환경이 있다. 러너 라벨에 깃허브 아이디를 붙여 두면 워크플로가 `github.actor`(머지한 사람)로 그 맥을 고른다.

## 한 번만 하면 되는 것

1. **준비물**: `gh` 로그인(`gh auth login`), Xcode, Homebrew의 `node@24`·`cocoapods`·`ruby`(bundler). 러너는 등록할 때의 셸 PATH를 저장해 쓰므로 **이 도구들이 보이는 터미널에서** 등록한다.
2. **키 파일**: App Store Connect API 키 `.p8`을 안수빈에게 받아 `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`에 두고 `chmod 600`. Key ID와 Issuer ID도 같이 받는다.
3. **등록 스크립트** (레포 체크아웃에서):
   ```sh
   .github/scripts/register-mac-runner.sh
   ```
   러너를 `~/actions-runner`에 내려받고, 라벨 `macOS, ios, <내 깃허브 아이디>`로 레포에 등록하고, ASC 값을 물어 `~/actions-runner/.env`에 적고, 로그인 시 자동 시작 서비스로 띄운다. 처음 실행할 때 macOS가 허용 창을 띄우면 허용한다.
4. **잠자기 방지**: 시스템 설정 → 배터리 → 옵션 → "전원 어댑터 연결 시 자동으로 잠자기 방지". 잠든 맥은 일을 못 받는다. 머지할 때마다 맥이 켜져 있다면 생략해도 된다.
5. **확인**: 레포 Settings → Actions → Runners에 내 맥이 **Idle**로 보이는지. 그다음 Actions → `iOS TestFlight (dev)` → Run workflow(라벨 입력란은 비움)로 내 맥에서 끝까지 도는지 한 번 본다. 처음 실행은 `npm ci`·`pod install`까지 해서 30분쯤 걸릴 수 있다.

## 빌드가 어떻게 도는가

- 트리거: `main` push 중 `app/app-dev/**` 변경, 또는 수동 실행. **PR에서는 돌지 않는다**(아래 "공개 레포" 참고).
- 러너 선택: `runs-on: [self-hosted, macOS, ios, <github.actor>]`. 수동 실행은 입력란에 다른 사람 아이디를 넣어 그 사람 맥에서 돌릴 수도 있다.
- 하는 일: `npm ci` → `app/app-dev/ios/testflight.sh --dev` (티켓 2218). 스크립트가 Pods 동기화, fastlane 설치, dev 서버 주소 고정, archive, TestFlight 업로드까지 한다. 테스트 노트 첫 줄에 `dev 서버(oneorthree.dev.mooo.com) 빌드 — <commit>`이 붙는다.
- 값의 출처: ASC 키는 각자 맥의 `~/actions-runner/.env`, 약관 버전은 레포 Variables의 `EXPO_PUBLIC_TERMS_VERSION`.
- 동시 실행은 하나로 제한된다(빌드 번호는 TestFlight 최신 + 1이라 겹치면 안 된다). 연달아 머지되면 뒤 것이 기다린다.
- 머지한 사람의 맥이 꺼져 있으면 잡이 "대기 중"으로 남았다가 맥이 켜지면 돈다.

## 공개 레포라서 지키는 것

이 레포는 공개 레포다. 개인 맥 러너에서 도는 워크플로에 `pull_request`나 `pull_request_target` 트리거를 **절대 추가하지 않는다** — 외부인이 보낸 PR의 코드가 팀원 맥에서 실행된다. 레포 설정(Actions → General)에서 외부 기여자의 워크플로 실행은 전부 승인 필요로 돼 있다. 새 워크플로를 만들 때 self-hosted 맥 라벨을 쓰려면 같은 원칙을 따른다.

## 자주 걸리는 것

| 증상 | 원인 · 조치 |
|---|---|
| 잡이 계속 "Queued" | 내 아이디 라벨의 러너가 없거나 오프라인. Settings → Runners에서 상태 확인, 맥에서 `~/actions-runner/svc.sh status` |
| "러너 .env 에 ASC_… 가 없다" | `~/actions-runner/.env`에 세 줄이 있는지 확인하고 `svc.sh stop && svc.sh start` (서비스는 시작할 때 .env를 읽는다) |
| "EXPO_PUBLIC_TERMS_VERSION 이 없다" | 레포 Variables에 값이 없음. 관리자가 Settings → Secrets and variables → Actions → Variables에 넣는다 |
| 서명·프로비저닝 실패 | fastlane이 ASC API 키로 프로파일을 받는다. 키의 역할이 App Manager 이상인지, 번들 id `com.oneorthree.focuscat`에 접근 권한이 있는지 확인 |
| `pod install`에서 죽음 | 맥의 CocoaPods·Ruby 버전. 로컬에서 `cd app/app-dev/ios && pod install`이 되는지 먼저 본다 |
| 링크 에러 `Sealable` 또는 즉시 크래시 | `ios/Pods`의 미리 빌드된 프레임워크 Debug/Release 표시가 어긋난 것. 러너 작업 폴더(`~/actions-runner/_work`)는 개발 폴더와 분리돼 있으니 그 안의 Pods를 지우고 다시 돌린다 |

러너를 빼려면 `~/actions-runner`에서 `./svc.sh stop && ./svc.sh uninstall && ./config.sh remove`.
