# 집중할고양 공개 웹

GROMO-2752. 앱과 같은 온보딩·게스트 계정·섬 탐색·집중 기록을 웹에서 제공한다. 이전 로컬 목업 체험판은 실제 서비스 연결로 교체했다.

- 대표 주소: https://try.oneorthree.world/
- PostHog: https://us.posthog.com/project/669473/dashboard/2305307
- 메타모아 검토 화면: https://metamoa.com/submit
- 2026-11-05 소유자의 약관·개인정보처리방침 동의를 받은 뒤 등록 신청을 접수했다. 현재 **심사 대기(pending)**이며 이메일은 보내지 않았다. 신청 조회 키는 Cloudflare 서버 비밀 환경 변수에만 저장했다.

## 웹과 앱의 범위

공개 웹은 기존 App과 서버 명령을 사용한다. 가입 없이 게스트 계정을 만들고 고양이 선택·닉네임 저장·첫 항해·망원경·섬 방문부터 시작한다. 프로필과 집중 기록은 서버에 보관한다. 브라우저의 계정 복구 정보는 localStorage에 남으므로 새로고침해도 이어지지만, 저장소 삭제 후에는 게스트 계정에 접근하지 못할 수 있다.

AI 집중 측정·휴대폰 사용 시간 측정·홈 위젯은 모바일 기능이다. 다른 앱 차단은 현재 iPhone에서 지원한다. 웹 권한·측정 앱 화면에는 모바일 기능 안내와 스토어 링크를 제공한다. 웹의 기본 집중·섬 기능을 목업이나 앱 전용이라고 안내하지 않는다.

Google 웹 로그인은 같은 OAuth 클라이언트와 기존 로그인 API를 쓰는 코드를 준비했다. `WEB_GOOGLE_LOGIN_ENABLED=1` 빌드에서 켠다. Google Cloud 프로젝트 `oneorthree2`의 기존 Web OAuth 클라이언트에 `https://try.oneorthree.world`를 승인된 JavaScript 원본으로 등록하고 확인한 뒤 활성화한다. 새 클라이언트나 비밀키를 만들지 않는다. 현재 브라우저 계정에는 프로젝트 접근 권한이 없어 관리 계정 전환을 요청한 상태다. 꺼진 배포는 게스트 로그인만 노출한다.

Google 인증은 별도 같은 출처 팝업의 공식 Google 버튼으로 실행한다. ID 토큰은 URL·저장소·로그에 쓰지 않고 opener에 전달한다. opener는 출처·창·state·nonce를 검사하고 기존 서버가 서명·aud·만료를 검증한다. 취소·팝업 차단·시간 초과 시 다시 시도할 수 있다.

## 웹 전용 섬: 구현 완료, 운영 반영 전

2026-11-05 결정: 웹 방문자는 새 웹 전용 섬 하나에 모이고, 그 섬에는 주민 수 제한을 두지 않는다. 사용자 수가 늘어 분리가 필요해지면 배정 정책을 확장한다. 현재 자동 분할이나 임의 임계치는 없다.

- `POST /me/web-island`: 인증된 본인만 입장한다. 서버가 배정 대상을 정하며 클라이언트는 섬 ID·정원을 지정하지 않는다.
- V11이 `islands.web_lobby`와 `web_island_pools`를 추가한다. 최초 실제 입장 시 `main` 배정 행을 잠그고 **함께 집중할고양** 섬을 한 번 생성한다. 아직 운영에 섬을 만든 것은 아니다.
- 일반 검색에 섞이지 않는 비공개 섬이며, 로그인 자격이 없는 운영 계정이 섬장을 맡는다. 방문자는 모두 주민이다. 기본 시설 7곳을 열어 집중·주민·게시판 등 기존 기능을 사용한다. 게스트의 소셜 로그인 필요 기능 및 AI·네이티브 제한은 기존 정책을 따른다.
- 웹 섬만 정원 검사에서 제외한다. 일반 섬의 1~15명 설정과 정원 검사, 강퇴 제약은 유지한다. 기존 앱 섬 소속은 제거하지 않는다.
- 고양이·이름 온보딩 완료 후 공용 섬으로 합류한다. 재접속에도 서버 배정을 확인한다. 실제 진행 집중은 강제로 종료하지 않고 복구하며, 결과 화면을 나간 뒤 합류한다.
- 웹의 망원경에는 배정된 섬만 표시하고 정원은 ‘제한 없음’으로 안내한다. 섬 만들기·소속 선택 화면은 공용 섬 입장으로 연결한다. 네이티브 빌드에는 웹 배정을 적용하지 않는다.
- 오류·응답 유실은 같은 멱등 키로 재시도하며, 로그아웃 뒤 늦은 응답은 버린다. 현재 섬의 동기화가 끝나야 온보딩을 완료한다.

운영 적용 순서:

1. 서버 변경 PR·검사·승격 후 소유자가 요청한 운영 배포로 Data API와 Business API를 반영한다. 기존 운영 DB의 수동 변경·Terraform은 필요 없다.
2. 서버 배포 성공 후 `WEB_SHARED_ISLAND_ENABLED=1 npm run build:web:demo`로 생성한 웹을 기존 Vercel 프로젝트에 배포한다. 서버가 준비되기 전에는 이 플래그를 켠 웹을 공개하지 않는다.
3. 실제 게스트 한 명의 온보딩·웹 섬 입장·집중·새로고침을 확인한다. AWS 부하 시험이나 다수 운영 계정 생성은 하지 않는다.
4. 메타모아 제출은 소유자의 약관·개인정보처리방침 동의 뒤 실행한다.

새 웹 섬 변경의 검증은 로컬 Testcontainers DB·모의 상류·클라이언트 테스트다. 16명 입장/동시 최초 입장/멱등/강퇴/진행 집중 보존, 공개·내부 API의 호출자 바인딩, 기존 가입·망원경 회귀를 확인했다. Checkstyle·SpotBugs·TypeScript 검사를 통과했다. V0~V11 실제 스키마와 DBML의 드리프트는 0건이다(기존 보상 정책의 `char(64)` 표기 4곳도 PostgreSQL 표현 `character(64)`로 문서만 맞춤).

## 반응형 프레임

웹의 논리 화면은 넓은 창 1280×800(16:10), 너비 700 미만 390×800이다. 머리말과 여백을 뺀 가용 너비·높이에 맞춰 iframe 안의 화면 전체를 같은 배율로 줄인다. iframe 높이만 줄이던 방식에서 작은 창의 로그인 화면이 스크롤되는 문제를 수정했다. 좁거나 높이 480 미만인 창은 바깥 여백을 없앤다. 문서 루트는 100dvh에 고정하며 iframe을 다시 만들지 않아 진행 상태가 유지된다. 소개는 한 화면에 놓고 긴 설명·개인정보 설정은 상단 안내에서 연다. 긴 목록·안내 패널 자체의 스크롤은 유지한다.

앱의 네이티브 배율은 바꾸지 않는다. `Btn`·`Txt`·`Sheet`·semantic 토큰을 재사용하며 웹의 캔버스 크기만 component 토큰으로 둔다. 이 worktree에 로컬 `.docs` UI Kit는 없어 DESIGN.md와 코드 정본을 사용했다.

## 배포 구조

- Vercel: `joejaeyoungs-projects/cattus-web-demo`, 정적 웹 자산.
- Cloudflare: `try` CNAME → `56e4e25e1485ed7c.vercel-dns-017.com`, 프록시 켬.
- Worker `cattus-web-api`: `try.oneorthree.world/service-api/*`만 담당한다.
- Worker route ID: `dc64ac2878894253bb78ac83d620aed4`.
- API·WebSocket 대상은 `https://catus-api-v2.oneorthree.world` 하나로 고정한다. 공개 앱 경로만 허용하고 내부 경로·다른 출처를 거절한다. 토큰·본문은 기존 서버에 전달하고 쿠키·응답 캐시는 전달하지 않는다. WebSocket upgrade 응답은 그대로 연결한다.
- 네이티브·개발용 웹의 API 선택 규칙은 유지한다. 공개 웹 플래그만 자기 출처 `/service-api`를 사용한다. `?review`·`?demo`로 공개 서비스를 목업으로 바꾸지 못한다.
- 운영 서버 배포·Terraform·AWS 부하 테스트를 실행하지 않았다. 실제 웹 확인은 단일 게스트의 기능 확인이다.

```sh
npm run build:web:demo
vercel link --yes --project cattus-web-demo --scope joejaeyoungs-projects --cwd build/web-demo
vercel deploy --prod --yes --scope joejaeyoungs-projects --cwd build/web-demo
```

빌드는 기존 EXPO_PUBLIC 입력과 .env를 배제하고 공개 웹 설정을 명시한다. Google 허용 주소 설정 후 활성화할 때만 `WEB_GOOGLE_LOGIN_ENABLED=1 npm run build:web:demo`를 사용한다. 약관 버전은 기존 앱 배포의 2026-09를 사용한다. build/web-demo는 매번 재생성하므로 Vercel link를 다시 실행한다.

Worker 소스는 `api-worker.mjs`, 독립 검사 명령은 `node --test web-demo/api-worker.test.mjs`다. 배포 시 Worker 모듈 업로드 후 위 경로의 기존 route만 유지한다. 다른 DNS·라우트·서버 설정은 수정하지 않는다. 인증은 로그인된 Cloudflare 브라우저 세션을 사용하며 키를 저장소에 보관하지 않는다.

## 에셋 압축 (GROMO-2787)

`build:web:demo`는 `expo export` 뒤에 `optimize-assets.cjs`로 `build/web-demo/assets`의 파일을 웹용으로 다시 압축한다. 네이티브 앱의 원본 에셋(`src/assets`)과 OTA는 바뀌지 않는다.

| 원본                      | 웹 결과물              | 기준                                                                                                                               |
| ------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| PNG·JPEG                  | 손실 WebP 품질 85      | 투명도는 무손실이다. 해상도를 유지해 번들의 width·height가 그대로다. 스프라이트 시트도 프레임 사이 투명 여백이 있어 같은 방식이다. |
| 이름에 `tileset`이 든 PNG | 무손실 WebP            | 맞붙여 그리는 타일의 이음매를 막는다. 지금 웹 번들에는 없다.                                                                       |
| 컷신 MP4                  | H.264 1080×1920 CRF 26 | 원본 대비 SSIM 0.98 이상. 소리 트랙은 원래 없다.                                                                                   |
| 고운돋움 TTF              | WOFF2                  | 글리프가 같다. expo-font 웹 로더가 `format()` 없이 `@font-face`를 만들어 주소만 바꾼다.                                            |

10% 넘게 줄지 않은 파일은 원본을 쓴다. 바꾼 파일은 새 내용의 해시로 이름을 정하고, JS 번들의 `uri:"/assets/…"` 문자열과 번들 이름·`index.html` 참조를 함께 옮긴다. 번들이 없는 파일을 가리키면 빌드가 실패한다. 원본 파일도 배포 폴더에 남긴다. 배포 직전에 열려 있던 탭이 옛 번들로 원본을 요청할 수 있기 때문이다.

필요한 도구는 `brew install webp ffmpeg woff2`로 설치한다. 없으면 빌드가 설치 명령을 알리고 멈춘다. 첫 빌드는 인코딩에 약 2분이 걸린다. 결과는 `build/.web-asset-cache`에 남아 다음 빌드부터는 바뀐 파일만 인코딩한다. 파일별 전후 크기는 배포 폴더 밖의 `build/web-demo-assets.json`에 쓴다. 주소 교체 검사는 `node --test web-demo/optimize-assets.test.mjs`다.

## 웹 분석

`web_demo_*`, `app_surface=web_demo`는 기존 대시보드와 이어지는 계측 이름이다. 실제 서비스 전환 뒤에도 같은 이름을 사용한다. 모바일 SDK는 공개 웹에서 초기화하지 않고 별도 웹 계측을 사용한다.

방문·화면 이동·집중 시작/휴식/재개/종료·스토어 클릭을 랜덤 브라우저 식별자와 방문 ID로 연결한다. 입력한 이름·할 일·채팅 본문과 로그인 토큰은 계측에 보내지 않는다. `$process_person_profile=false`, `$geoip_disable=true`이고 화면 녹화는 하지 않는다. 랜덤 ID로 재방문을 구분하므로 완전한 익명화를 보장하는 표현은 쓰지 않는다.

상단 이용 안내의 ‘개인정보·분석 설정’에서 수집 내용과 끄기/켜기를 제공한다. 꺼진 선택은 새로고침 뒤에도 유지되고 랜덤 ID와 방문 정보를 지운다. `analytics_test=1`·자동화 브라우저·localhost는 `analytics_excluded=1`이다. 이것은 개발 검증 방문 표시이며 일반 브라우저 방문은 제외하지 않는다.

게시된 대시보드는 최근 28일의 방문·순서가 있는 집중 전환·유입 경로·이벤트 순서·탭 숨김을 보여준다. 다섯 쿼리를 실제 PostHog 저장 이벤트로 실행하고 대시보드 화면에서 확인했다. `analytics-dashboard.json`에 ID를 기록했다. 스토어 클릭은 설치 완료가 아니며 탭 숨김은 확정 이탈이 아니다. 동의 거부·광고 차단·네트워크 실패 시 누락될 수 있다.

## 검증 기록

- 화면 맞춤: 1920×1080, 1280×900, 1136×650, 1024×768, 700×500, 390×844, 320×568, 844×390에서 소개·로그인 문서 및 내부 ScrollView가 넘치지 않고 동일 iframe을 유지한다. 실제 로그인 진입·분석 끄기 선택 유지 검사를 로컬과 공개 주소 모두 통과했다. 브라우저 자동 검사는 한국어 로케일을 명시하며 계정을 만들지 않는다.
- 실제 서비스: 단일 게스트 발급, 고양이·닉네임 저장, 첫 항해, 실제 섬 방문, 일반 망원경 및 항해 집중 시작 201·종료 200 확인. 새로고침 뒤 같은 게스트와 95초 항해 기록이 유지되고 진행 세션은 없는 것을 확인했다.
- 꾸미기 카탈로그 경로 누락을 보완해 20개 항목의 정상 응답과 내 꾸미기 화면을 확인했다. 인증된 WebSocket의 STOMP CONNECTED 수신 후 검증 소켓을 닫았다.
- 웹의 앱 권한 관리에서 AI·휴대폰 사용 시간·iPhone 차단 안내와 두 스토어 버튼을 확인했다. PostHog에 검증 방문의 집중 시작·종료·화면 이동 이벤트가 저장되는 것도 조회했다. 검증 방문은 일반 방문 대시보드에서 제외한다.
- 공개 웹 모드·인증·API·집중·망원경·계측·Google 자격 전달 관련 Jest 9개 스위트 184개 통과. 웹 게스트 복구 ID 재사용과 로그아웃 회전 포함.
- Worker 검사 4개 통과: 꾸미기 카탈로그, 인증/본문 전달, 출처/내부 경로 거절, WebSocket upgrade 보존. 외부 서버에 요청하는 테스트가 아니다.
- TypeScript·포맷 검사 통과. 변경 TypeScript의 ESLint 오류 0개(경고 6개). Google 관리 계정 인증과 실제 Google 로그인 검증은 남아 있다.
- 공개 웹 배포: `cattus-web-demo-kkcs6jm29-joejaeyoungs-projects.vercel.app` → 대표 주소 연결 완료. API Worker의 꾸미기 경로 보완도 배포했다.
- 모바일 검증은 브라우저 에뮬레이션이다. 실기기 Safari 검증으로 간주하지 않는다.

## 메타모아 신청

신청 정보는 `submission.json`이며 `api_hookup=true`, 한국·한국어, 이메일 없음이다. 메타모아는 사람이 승인한다. 등록 동의와 승인·소유자 확인·공간 키 발급은 서로 다른 단계다. 웹훅은 사용하지 않고 인증된 결과 조회 API를 사용한다.

1. 소유자가 https://metamoa.com/terms · https://metamoa.com/privacy 동의를 명시해야 한다.
2. Cloudflare CLI로 기존 계정에 로그인한다. OAuth 자격은 macOS Keychain으로 보호하며 Worker 스크립트 쓰기와 계정 조회 권한만 요청한다.
3. 동의 확인 뒤 `node web-demo/metamoa-submit.cjs --agree`를 실행한다. 신청 전 서버에 진행 표시를 저장해 중복 POST를 막고, 응답 `request_key`를 메모리에서 Cloudflare Worker의 비밀 환경 변수로 직접 보낸다. 로컬 `.env`·코드·채팅·로그에 쓰지 않는다. 저장 실패 시 프로세스를 종료하지 않고 Enter로 저장만 재시도한다.
4. 서버 환경 변수 `METAMOA_ADMIN_KEY`를 가진 운영 작업에서 `node web-demo/metamoa.cjs --status`로 결과를 본다. `pending`이면 승인 대기다. 승인 뒤 `https://metamoa.com/owner?id=<id>`에서 소유자 확인한다.
5. 사이트 확인 코드를 메타 태그 또는 루트 HTML 파일에 넣어 배포하고 소유자 확인을 완료한다. 발급된 공간 키는 서버 비밀 환경 변수 **`METAMOA_KEY`에만** 저장한다. 확인 코드는 재검증에 필요하므로 계속 유지한다.
6. `METAMOA_SPACE_ID`를 설정하면 cron이 접속자 수를 전송한다. 업데이트·이벤트는 실제 내용과 일정이 정해졌을 때 관리 API로 보낸다. 임의 소식·이벤트를 자동 생성하지 않는다.

### 서버 구성

Worker 소스는 `api-worker.mjs`와 `metamoa-worker.mjs`, 구성은 `wrangler.jsonc`다. 기존 `try.oneorthree.world/service-api/*` 라우트를 유지한다. Durable Object `MetamoaPresence`는 이 Worker의 내부 바인딩으로만 접근한다.

서버 비밀 환경 변수: `METAMOA_REQUEST_KEY`, `METAMOA_SUBMISSION_ID`, `METAMOA_KEY`, `METAMOA_SPACE_ID`, `METAMOA_ADMIN_KEY`, `METAMOA_PRESENCE_SALT`. 공개 웹 빌드에 넣는 값은 없다. 관리 키와 salt는 독립된 암호학적 난수다. Worker 코드를 교체할 때 기존 `secret_text` 바인딩을 보존한다.

- 로그인한 활성 웹 탭은 2분에 한 번 기존 `/me` 인증 조회에 `X-Metamoa-Presence: 1`을 붙인다. 네이티브·로그아웃·숨긴 탭·자동화·`analytics_test=1` 방문은 보내지 않는다.
- 서버가 인증한 성공 응답만 집계한다. 사용자 ID는 salt를 사용한 HMAC으로 바꿔 내부 저장소에 넣고 5분이 지나면 제외·삭제한다. 탭과 프록시 인스턴스가 달라도 같은 계정은 한 명이다. 이름·입력·채팅·토큰·IP는 저장하지 않는다.
- 10분 cron은 `POST https://metamoa.com/api/live/<id>`에 `{count}`만 전송한다. 키가 없으면 보내지 않으며 중복 cron은 마지막 시도 뒤 9분 이내에 보내지 않아 정각 실행의 지연을 허용한다. 네트워크 실패는 `last_sync.status=0`으로 기록한다. 집계는 최근 5분 활성 웹 계정 수이며 모바일 앱 전체 인원이 아니다.
- `/service-api/metamoa/status`, `sync-status`, `update`, `events`는 독립된 관리 키로 인증한다. 공간 키 자체를 클라이언트에 반환하는 경로는 없다.

```sh
node web-demo/metamoa.cjs
# 아래 명령은 관리 키를 서버 환경 변수로 주입받아 실행한다.
node web-demo/metamoa.cjs --status
node web-demo/metamoa.cjs --sync-status
node web-demo/metamoa.cjs --update < update.json
node web-demo/metamoa.cjs --event < event.json
node web-demo/metamoa.cjs --events
node web-demo/metamoa.cjs --delete-event 123
# 캐릭터 게시를 선택한 경우: 기존 512×512 투명 PNG(176KB).
node web-demo/metamoa.cjs --character-png < src/assets/ota/onboarding/cat-cream.png
node web-demo/metamoa.cjs --character-status
```

독립 검사: `node --test web-demo/api-worker.test.mjs web-demo/metamoa-worker.test.mjs`. 외부 서버에 요청하지 않고 인증·중복·만료·봇 제외·전송 간격·키 비노출을 확인한다.

신청 응답 뒤 서버 저장에 실패하면 실행 프로세스를 유지하고 저장만 다시 시도한다. 프로세스까지 종료됐으면 `PENDING`을 지우거나 재신청하지 말고 메타모아 운영자에게 기존 신청의 키 복구를 요청한다. 공간 키와 공간 ID는 `WRANGLER_LOG_SANITIZE=true WRANGLER_SEND_METRICS=false npx --yes wrangler@4.157.0 secret put METAMOA_KEY --name cattus-web-api` 및 같은 방식의 `METAMOA_SPACE_ID` 입력으로 서버에 저장한다. 비밀을 명령행 인자·파일에 넣지 않는다.

Cloudflare Workers 외부 요청은 `redirect: manual`을 쓴다. 지원하지 않는 `error` 모드는 요청 전에 예외가 발생한다. 3xx는 호출자가 실패로 처리하며 다른 호스트로 키를 전달하지 않는다. 근거: https://developers.cloudflare.com/workers/runtime-apis/request/
