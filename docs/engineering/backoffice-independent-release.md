# 백오피스 독립 릴리스

서버는 기존 `release`와 `prod-cd`를 사용한다. 백오피스는 `main`의 조상 커밋에 붙인 `backoffice-vX.Y.Z` 태그로 `backoffice/`만 빌드하고 별도 승인·배포 이력을 남긴다. 서버와 백오피스의 커밋 SHA를 일치시키지 않는다.

## API 호환 경계

백오피스 BFF는 Data·Notification HTTP API만 호출한다. 단, 화면 표시용으로 `itunes.apple.com` 조회 한 건을 더 보낸다(운영자 토큰 없음, 실패해도 작업은 막지 않는다). 서비스 DB에는 직접 접속하지 않는다. `backoffice/server/contract.json`이 이 버전의 필수 계약이다.

- Data `/internal/admin/content/environment`: `environment`, `contractVersion: "1"`, `capabilities`.
- Notification `/internal/admin/publications/environment`: 위 필드와 `fcmProjectId`.
- 두 환경 응답의 선택 필드 `serverVersion`(배포 커밋)·`schemaVersion`(DB 마이그레이션 번호). 화면 표시 전용이며 필수 계약이 아니다. 없는 구버전 서버는 「-」로 표시한다.
- Data 필수 capability: `content.publication.v1`, `content.history.v1`, `content.notice.withdraw.v1`, `content.app-requirements.v1`, `construction.policy.v1`, `focus.policy.v1`.
- Notification 필수 capability: `notification.publication.v1`, `notification.history.v1`, `notification.templates.v1`.

응답에 추가 필드나 capability가 있어도 허용한다. 필수 capability 누락·계약 버전 불일치·DB 환경 불일치·FCM 프로젝트 불일치는 기동과 상류 작업을 차단한다. 실제 필드 의미·상태 전이·멱등 처리의 호환성을 계약 테스트로 유지하며 capability 이름만 선언하고 구현을 바꾸면 안 된다. 비호환 변경에는 새 계약 버전을 추가하고 구계약을 병행 제공한다.

첫 운영 도입은 필요한 Data·Notification API/마이그레이션 선별 배포 → 인증된 환경·계약 확인 → 백오피스 배포 순서다. 이후 기존 계약을 지원하는 서버에서는 백오피스만 배포하거나 롤백할 수 있다.

## 최초 인프라 설정

- 전용 IAM `catus-backoffice-publish`: 백오피스 ECR push/조회, 아래 S3 release prefix에 조건부 생성·조회만 허용한다.
- 전용 IAM `catus-backoffice-deploy`: 같은 prefix 조회, ECR DescribeImages, 지정된 SSM 문서와 백오피스 인스턴스의 SendCommand 및 명령 상태 조회만 허용한다.
- 버킷 `catus-backoffice-prod-backups-808715036056`, release prefix `releases/`. SQLite prefix는 GitHub 역할이 접근하지 않는다. 버전 관리를 켜고 `If-None-Match: *` 없는 release PUT, release 삭제·버전 삭제를 bucket policy로 거부한다.
- 저장소 변수 `BACKOFFICE_RELEASE_BUCKET`에 위 버킷, `BACKOFFICE_SSM_DOCUMENT_VERSION`에 검증된 `catus-backoffice-app-deploy`의 숫자 버전을 설정한다. `$LATEST`/`$DEFAULT`는 금지한다.
- GitHub environment `backoffice-production`은 독립 승인자를 지정하고 `main`만 배포하도록 보호한다.
- `backoffice-v*` 태그 ruleset에서 생성 권한을 릴리스 담당자로 제한하고 이동·삭제를 금지한다. 태그 workflow의 OIDC 권한을 악용하지 못하도록 workflow 변경은 코드 리뷰로 보호한다.

## 발행과 배포

`Backoffice Release`는 태그 형식·main 조상 여부를 확인하고 Node 테스트·프런트 빌드·배포 스크립트 테스트를 실행한다. ARM64 이미지를 불변 ECR 태그로 올리고 소스 SHA 이미지 label을 확인한다. manifest는 태그·소스 SHA·ECR digest·SSM 문서와 숫자 버전·인스턴스·필수 API 계약을 포함한다. `releases/<tag>.json`을 조건부 생성한다. 재실행 시 기존 이미지와 manifest가 동일할 때만 성공하며 기존 릴리스를 덮어쓰지 않는다.

운영 담당자는 `Backoffice Production Deploy`를 **main에서** 실행하고 `release_tag`를 선택한다. 승인 후 main 조상과 태그 SHA, manifest 소스 SHA, ECR 태그의 digest를 대조한다. manifest에 고정된 SSM 문서 버전과 이미지 digest로 백오피스 인스턴스만 배포한다. 릴리스 시점에 사용한 문서 버전은 이후에도 삭제하지 않는다. SSM 문서 버전을 변경한 배포는 새 릴리스 태그로 발행한다.

SSM은 앱의 모든 운영자 환경/계약 확인 및 health 통과, 첫 SQLite 백업, 백업 timer 활성화를 마친 뒤 공개 nginx를 연다. CI 성공 여부와 command ID, 릴리스 manifest는 실행 이력에서 확인한다. 업무의 실제 FCM 발송·게시를 배포 검증에서 자동 실행하지 않는다. AWS 부하 테스트 및 부하 데이터 생성은 금지한다.

## 실패·재시도·롤백

동일 GitHub run을 재실행하면 `backoffice:<run_id>`로 이미 전송한 SSM 명령을 찾아 문서·버전·인스턴스·digest가 일치하는지 확인하고 상태를 이어서 조회한다. 이전 전송이 불확실하고 명령을 찾지 못하면 자동 재전송하지 않는다. SSM 명령이 실제 실패한 경우 상태·로그·nginx 차단 여부를 확인한 뒤 원인을 수정하고 새 workflow run을 시작한다. polling 시간 초과는 명령 취소나 배포 성공을 의미하지 않는다.

롤백은 같은 배포 workflow에 **이전에 성공한 릴리스 태그**를 입력해 새 실행한다. 이미지를 다시 빌드하지 않으며 이전 digest와 문서 버전을 그대로 사용한다. 실패 시 인프라 스크립트는 이전 앱 복구를 시도하지만 공개 nginx를 차단한 채 실패하므로 자동 서비스 복구 완료로 해석하지 않는다.

앱 rollback은 SQLite 데이터 rollback과 다르다. 스키마 변경은 이전 앱과의 읽기/쓰기 호환성을 유지해야 한다. 비호환 스키마 변경에는 별도 백업 복원·복구 검토가 필요하다. 백오피스는 단일 프로세스이며 재시작하면 세션이 종료되고 진행 중 요청은 결과 확인 필요 상태로 복구된다.
