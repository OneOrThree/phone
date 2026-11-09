# AGENTS.md — 백오피스

운영진이 공지·운영진의 편지·강제 업데이트 최소 버전·고양이 잡지·정책(집중·황금 물고기·건설)·꾸미기 지급·꾸미기 아이템 현황과 추첨 풀·출시 현황·모니터링 링크를 다루는 관리 웹이다. 루트 `AGENTS.md`·`CLAUDE.md`에 더하는 규칙이고, 상세는 [README.md](README.md)에 있다.

## 구조와 검증

- Node 24 백오피스 서버(`server/*.mjs`)와 React 18·Vite·TypeScript 화면(`src/`)이다. 상태는 SQLite(`BACKOFFICE_STATE_DIR`, 기본 `var/`)에 둔다.
- 로컬 모드는 `npm ci && npm run build && npm start` → `http://127.0.0.1:4310`, `test`/`test`다. 외부 서비스를 부르지 않는다.
- 검증은 `npm test`(승인·복구·인증·CSRF)와 `npm run build`(TypeScript·번들)다.
- 인증은 운영자 세션 쿠키(8시간)와 CSRF 값이다. 연결 모드 운영자는 `member-1`~`member-3`이고, 앱 JWT는 쓰지 않는다.

## 머지가 곧 운영 배포다

- `backoffice/**`(`.md` 제외)가 main에 머지되면 `backoffice-cd.prod-V2`가 테스트 → `backoffice-production` 승인 1회 → `backoffice-vX.Y.Z-V2` 발행 → `catus-backoffice-prod-V2`(`backoffice-v2.oneorthree.world`) 배포를 한다. dev 백오피스는 없다.
- 백오피스가 쓰는 Data·Notification 계약이 운영에 먼저 있어야 한다. 없으면 백오피스가 기동을 거부해 배포가 실패하고, 호스트가 직전 버전으로 돌아간다.
- `.md`만 바꾸면 CD는 돌지 않는다. 다만 백오피스 지문(`catus-runtime-V2.py`)은 바뀌어 다음 발행에서 이미지를 다시 빌드한다.
- 절차와 롤백은 [prod V2 파이프라인 「백오피스」](../docs/engineering/prod-v2-pipeline.md#백오피스)를 따른다.

## 지킬 것

- 브라우저에는 운영자 세션만 보낸다. 서비스 토큰은 백오피스 서버 안에만 두고, `/internal/**`는 인터넷에 열지 않는다.
- 운영 데이터는 백오피스 서버가 Data·Notification 내부 HTTP를 운영자별 토큰으로 불러 읽고 쓴다. DB에 직접 붙지 않는다.
- 인스턴스는 하나만 띄운다. 정책 작업 잠금이 프로세스 안에 있다.
- SQLite는 코드로만 바꾼다. 상태·발송자·publicationId를 손으로 고치지 않는다.
- 결과 확인 필요(`uncertain`·`approval_uncertain`) 항목은 최초 운영자가 같은 요청으로 재시도한다. 새 초안으로 다시 보내지 않는다.
- 테스트와 배포 검증에서는 실제 발송·게시를 하지 않는다. 발송 게이트(dispatch gate)는 사람이 연다.
- 부하 시험은 루트 `CLAUDE.md` 「Hard lines」 2번을 따른다.
