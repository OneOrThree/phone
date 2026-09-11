# GROMO 링크 서버

GROMO-1660의 독립 Next.js 서비스다. 기존 `/l/{slug}` 랜딩·AASA·기기 fingerprint 매치, 초대 귀속과 알림 관리 콘솔을 소유한다. 저장소는 `OneOrThree/link`, 실행은 Vercel, 장부는 별도 Neon Postgres가 배포 목표다. `phone` 안의 `link/`는 인도 전 작업 위치이며 기존 Data DB를 연결하면 안 된다.

## 실행과 검증

Node 22와 Docker가 필요하다. `.env.example`을 `.env.local`로 복사하고 전용 DB와 필수 자격을 채운다. migration 명령에는 `DATABASE_URL`을 프로세스 환경으로 전달한다. 로컬 env 파일은 버전 관리에서 제외한다.

```sh
npm ci
npm run migrate
npm run dev
npm run verify
```

`verify`는 lint, TypeScript, 실제 Postgres 16 경합 테스트, production build를 실행한다. migration은 `scripts/migrate.mjs`가 파일명 순서로 적용하고 체크섬을 기록한다. 이미 적용한 SQL 파일을 바꾸면 기동 준비가 실패한다.

## 공개·내부 표면

| 표면 | 역할 | 인증 |
|---|---|---|
| `GET /l/{slug}` | 기존 HTML·200 만료 랜딩, 봇 제외 클릭 적재 | 공개 |
| `POST /l/match` | SHA-256(ip+기존 salt), OS, 3시간 창으로 단일 클릭 소진 | 공개·신뢰된 IP |
| `GET /.well-known/apple-app-site-association` | 기존 iOS 앱·`/l/*` 계약 | 공개 |
| `GET /.well-known/assetlinks.json` | 실제 Android 서명값이 있을 때만 제공 | 공개 |
| `POST /internal/links`, `GET /internal/links/{slug}`, `POST /internal/links/{slug}/claim` | 발급·가입 capability·잠정 귀속 | Business Bearer, 쓰기 `X-User-Id` |
| `POST /internal/links/match` | 이관 중 동결 후보를 Neon에서 import+소진 | Business Bearer |
| `POST /internal/events` | Data의 전체 EventEnvelope를 폐기·확정·가입·표시정보·탈퇴에 적용 | Data Bearer |
| `POST /internal/migration/{import,verify,close}` | 동결 원본 백필·검증·종료 | 일회성 migration Bearer |
| `/notifications/{jobs,templates,deeplinks,deliveries}` | 알림 설정·미리보기·테스트·재발송 | 콘솔 세션, 쓰기 sudo |
| `GET /health` | DB 접속과 필수 테이블 확인 | 공개, 상세·자격 미노출 |

Business와 Data 서비스 토큰은 서로 다른 값이다. Data용 경로를 Business 자격으로 호출하면 403이다. 모든 내부 명령은 같은 재시도 키와 본문을 사용한다. 같던 키의 본문이 달라지면 409다. `/internal/events`는 봉투 `eventId`를 사용한다. 지원하지 않는 schemaVersion/type은 422로 실패하며 성공으로 소실시키지 않는다.

콘솔은 각자 다른 비밀번호 세 개와 sudo 비밀번호 한 개를 해시로 보관한다. `scripts/hash-password.mjs`는 표준 입력을 받아 scrypt 해시만 출력한다. 세션은 DB에서 만료·철회되며 쿠키는 HttpOnly·Secure(HTTPS)다. 쓰기는 Origin·CSRF·sudo를 검사한다. Notification의 서비스 토큰은 서버 측 프록시에만 있고 브라우저 응답으로 내보내지 않는다. 실제 감사 주체는 `member-1`~`member-3`다.

## IP와 기존 앱 호환

직접 Vercel 요청은 `x-vercel-forwarded-for`를 사용한다. 기존 API 도메인에서 프록시할 때 nginx는 Cloudflare CIDR에서 온 연결에만 `CF-Connecting-IP`를 신뢰하고, 검증된 IP를 `X-Link-Client-IP`, 공유 비밀을 `X-Link-Proxy-Secret`으로 다시 쓴다. 외부 XFF는 Vercel이 덮어쓰므로 전달 계약으로 쓰지 않는다. [`Vercel 요청 헤더`](https://vercel.com/docs/headers/request-headers)

이관 중 `/l/match`는 Business 호환 핸들러가 동결된 Data 후보를 가져와 `/internal/links/match`에 전달한다. 직접 쓰기를 열고 호환 핸들러를 종료한 뒤 구 API 도메인의 match 프록시를 Vercel로 돌린다. 구 경로 제거는 새 호스트 앱이 최소 지원 버전이며 구 경로 요청이 7일 연속 0건일 때만 한다.

## 이관 입력과 재개

`LINK_MIGRATION_ID`를 이관 시작 전에 설정한다. 해당 run이 `IMPORT_CLOSED`가 아니면 직접 클릭·발급·claim·relay 적용은 503으로 닫힌다. 호환 매치만 `IMPORTING` 중 동결 후보를 import해서 소진한다. Data 요청형 변경은 outbox/claim-intent에 보존한다.

`/internal/migration/import` 입력은 `migrationId`, `expectedClicks`, `sourceChecksum`, `expectedLinks`, `linkChecksum`, `clicks`, `links`다. 각 배열 원소는 `{source,sourceChecksum}`이다. 빈 배열로 run을 먼저 등록하고 클릭·링크 배열을 각각 최대 20개씩 분할한다(운영 CLI 기본값은 10개). 모든 batch는 동일한 전체 count/checksum을 사용한다.

- `source`의 정확한 필드/nullable/형식은 `src/lib/migration.ts`의 `FrozenClick`·`FrozenLink`다. bigint version은 JSON 문자열, 시각은 UTC ISO 밀리초로 정규화한다.
- 각 checksum은 키를 재귀적으로 정렬한 UTF-8 JSON의 SHA-256이다. 배열 순서는 보존한다.
- 전체 클릭 checksum은 clickId 오름차순 `[{clickId,sourceChecksum}]`, 전체 링크 checksum은 linkId 오름차순 `[{linkId,sourceChecksum}]`에서 계산한다.
- 클릭이 0개인 링크도 `links`에 포함한다. 그렇지 않으면 기존 공유 slug가 사라진다.
- 같은 클릭의 호환 소진과 백필은 Neon 트랜잭션의 marker·원본 checksum·audit로 병합한다. 이미 소진한 행을 구 값으로 덮지 않는다.
- `verify` 성공 뒤 `close`가 실행 중 import/호환 TX를 drain하고 종료한다. 실패하면 원본을 바꾸지 않고 같은 run에서 누락 batch를 재실행한다. `close` 후 늦은 importer는 409다.
- `close` 후 Data의 outbox와 Business claim-intent 재개 CLI를 처리한다. 이 시점 이후에는 Neon 장부를 유지하며 앞으로 수정한다. 구 DB로 자동 복귀하지 않는다.

운영 Neon·Vercel 연결, 실제 시크릿 주입, Android 서명값, DNS/프록시 전환과 실데이터 백필은 별도 실행 단계다. 로컬 테스트 통과가 운영 이관 검증을 대신하지 않는다.
