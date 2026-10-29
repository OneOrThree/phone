# 콘텐츠 백오피스

FCM 서비스 공지, 앱 내 개발자 공지, 잡지를 작성 → 검토 요청 → 승인 → 발송·게시하는 독립 웹이다. 브라우저에 내부 서비스 토큰을 보내지 않는다.

## 로컬 실행

Node 24 이상이 필요하다. 로컬 모드는 외부 서비스 호출 없이 영구 저장과 승인 절차를 검증한다. 잡지의 섬·랭킹 데이터는 비어 있고 실제 잡지의 미리보기가 아니다.

```sh
npm ci
npm run build
# 12자 이상 비밀번호를 표준 입력으로 전달하면 salt:hash를 출력한다.
npm run --silent password
export BACKOFFICE_OPERATORS='{"member-1":{"passwordHash":"위 명령에서 얻은 해시"}}'
npm start
```

http://127.0.0.1:4310 에서 member-1과 지정한 비밀번호로 로그인한다. 비밀번호 해시를 만드는 명령은 입력을 마친 뒤 EOF를 전달한다. 원문 비밀번호나 서비스 토큰을 git에 기록하지 않는다.

Vite 개발 화면을 쓸 때에는 BFF의 `BACKOFFICE_ORIGIN=http://127.0.0.1:5173`을 설정하고 `npm run dev`를 별도 실행한다. 기본 빌드 화면은 4310 포트 하나에서 제공한다.

## 서비스 연결

| 설정 | 의미 |
| --- | --- |
| `BACKOFFICE_MODE=connected` | 내부 API 연결 활성화. 기본 local |
| `BACKOFFICE_ORIGIN` | 실제 HTTPS 출처. 경로 없는 `https://운영주소` |
| `BACKOFFICE_OPERATORS` | member-1~3별 `{passwordHash,notificationToken,dataToken}` JSON |
| `NOTIFICATION_URL` | 비공개 notification HTTP(S) 주소 |
| `DATA_API_URL` | 비공개 Data HTTP(S) 주소 |
| `BACKOFFICE_STATE_DIR` | SQLite 및 WAL 영구 저장 폴더. 기본 var |
| `BACKOFFICE_HOST`, `PORT` | 기본 127.0.0.1:4310. 연결 모드 컨테이너는 0.0.0.0 |

운영자별 notificationToken은 Notification의 member-1~3 admin token, dataToken은 Data의 `SVC_TOKEN_CONSOLE_MEMBER_1_TO_DATA`(2/3도 동일)와 맞춘다. member 번호와 토큰의 actor가 다르면 거부된다. 서비스 간 토큰을 공유하지 않는다. 비밀은 프로세스 환경/비밀 관리 시스템으로만 주입한다.

HTTPS 역방향 프록시 뒤에 단일 인스턴스로 운영한다. 인터넷에 내부 `/internal/**` 경로를 개방하지 않는다. 백오피스 서버만 서비스망에 접속한다. SQLite 폴더는 전용 영구 볼륨으로 두고 일관된 SQLite 백업 방식으로 보존한다. 디스크·백업에는 검토 원문과 사용자 UUID가 있으므로 운영자만 접근할 수 있어야 한다. 로컬/연결 모드는 DB 파일이 분리되어 모의 게시를 운영 게시로 오해하지 않는다.

세션은 HttpOnly·SameSite=Strict·연결 모드 Secure 쿠키, 8시간 수명이다. 모든 변경 요청은 정확한 Origin과 CSRF 값을 확인한다. 서버 재시작은 세션을 종료하며, 진행 중인 발송은 결과 확인 필요 상태로 바꾼다. 같은 최초 발송자가 재시도하면 동일 publication UUID가 사용된다. 멀티 인스턴스 배포는 지원하지 않는다.

## 운영 절차

- 저장 후 검토 요청 → 승인 → 발송·게시 확인. 수정하면 승인은 취소되고 새 수정본이 된다. 승인자와 발송자, 시각은 감사 이력에 남는다. 같은 운영자가 검토·승인할 수 있다.
- FCM: 기본 `ADMIN_ANNOUNCEMENT`, 명시적인 사용자 UUID 1~100명. 수신 동의·탈퇴·조용한 시간·dispatch gate를 따른다. 응답 `PENDING`은 접수이며 기기 수신 완료가 아니다. 게이트를 백오피스가 자동으로 켜지 않는다. 추가 payload는 문자열 JSON이고 실제 발송 크기는 Notification이 검증한다. 다른 kind는 기존 사건의 subjectId/params 적격 조건을 충족해야 한다.
- 개발자 공지: 평문 제목·본문과 게시 시작/종료 시각을 지정한다. 앱 설정의 개발자 공지에서 현재 게시 기간의 내용을 읽는다. HTML을 렌더링하지 않는다. 게시 후 수정/철회는 이 버전에서 지원하지 않으며 게시 종료 시각으로 노출을 제한한다.
- 잡지: 날짜·편집부 소식(80자)을 넣고 게시 내용을 불러온다. 서버가 보관한 스냅샷을 검토·승인한다. 섬 홍보가 바뀌면 409로 재검토를 요구한다. 실제 앱과 같은 픽셀 배치를 보장하는 화면은 아니다. 당일 KST 07시 이후 게시할 수 있다.
- 응답 유실 시 새 초안을 만들어 중복 발송하지 않는다. 결과 확인 필요 항목의 같은 요청을 재시도한다. 명확한 거부는 처리 실패로 남으며 내용을 수정해 다시 검토한다.

**잡지 운영 변경:** 기존 10분 주기 자동 호 생성은 제거된다. 운영자가 승인·게시해야 그날 호가 생긴다. 스케줄러는 이미 게시된 호의 알림을 재시도한다. 서버 적용 전에 백오피스 운영자 자격과 매일 게시 담당자를 준비해야 한다.

## 검증

`npm test`는 승인 우회·수정·중복·재시작 복구·스냅샷 검증·인증·CSRF·고정 상류 요청을 로컬에서 검사한다. `npm run build`는 TypeScript와 배포 번들을 검사한다. AWS 부하 테스트와 부하 데이터 생성은 영구 금지이며 이 도구의 검증에 사용하지 않는다.
