# Catus 데이터베이스 V0

현재 실행 스키마는 `src/main/resources/db/v0/V0__baseline.sql`이다. 빈 DB는 V0를
적용하고, 다음 변경은 같은 디렉터리에 `V1__*.sql`부터 추가한다. 기존
`db/migration/V1`~`V138`은 과거 이행 테스트와 전환 전 이력 검증용으로 보존하며
dev/prod/loadtest 애플리케이션에서는 실행하지 않는다.

V0에는 V138 기준 현재 사용하는 77개 테이블의 구조가 들어 있다.
Gromo 봇·리그·챌린지·구 코인·아이템·태그 등 41개 테이블과 폐기한 계정 필드는
제외한다. 섬 테이블의 현재 이름은 `islands`다. `group_members` 등 연관 테이블과
`group_id` 컬럼 이름은 유지한다. 새 DB에 사용자나 봇, 집중 이력을 생성하지 않는다.

## 기본 데이터와 새 배포

기본 데이터 정본은 `src/main/resources/db/seed/insert.sql` 하나다. Gradle의
`processResources`가 `db/v0/afterMigrate__defaults.sql`로 복사하므로 새 DB와
이미 V0인 DB 모두 Flyway migrate 후 실행한다. 신규 migration이 없는 재배포에서도
누락된 기본 행을 복구한다. 콜백은 migration 이력을 추가하지 않아 `flyway_schema_history`는
번들된 V0 체인(V0·V1 …)의 행만 가진다. 원본 SQL을 복사해 별도로 수정하지 않는다.

| 테이블 | 기본 행 수 |
|---|---:|
| construction_cost_policies / construction_cost_policy_publication | 7 / 1 |
| focus_reward_policies | 1 |
| catalog_assets | 157: 잡지 64·음원 3·꾸미기 90 |
| magazine_asset_meta / audio_tracks | 64 / 3 |
| customization_reward_policies | 2: revision 1·2 |
| customization_reward_items | 110: revision 1의 90종·revision 2의 머리/목 20종 |

총 345행이며 V135의 현재 추첨 정책 revision 2와 V136의 6색 렌더 데이터를 보존한다.
`reward-catalog-v1.json`에 기록된 정적 파일 114개는 기존 정적 배포에 포함되어 있어야 한다.
기존 개인 소유권·정산·운영 추가 카탈로그는 기본 SQL에서 생성하거나 변경하지 않는다.
로컬 전용 `server/scripts/local/seed-customization.sql`의 오리 모자·단계 보상은 포함하지 않는다.

건물 종류의 초기 7행과 선행 관계는 V2 마이그레이션이 만든다. 건물 ID는 기존 API·시설·가격표의
계약이므로 변경하거나 삭제하지 않는다. 이후 건물을 추가할 때는 한 DB 트랜잭션에서 건물 행과
선행 관계를 넣고, **모든 건물을 포함한 새 비용 정책 revision**을 만든 뒤 publication을 전환한다.
공개된 revision은 수정하지 않는다. 선행 관계에 순환이 생기면 건설할 수 없는 건물이 생기므로
추가 전에 순환이 없는지 확인한다. 기본 데이터 콜백은 기존 7개 비용 행만 보완하며 새 건물을
복구하지 않는다.

SQL은 하나의 `DO` 문에서 전용 advisory transaction lock과 기본 테이블 잠금을 잡는다.
동시 기동도 직렬화하며, 중복 키는 추가하지 않는다. 기존 건설 비용·발행 포인터와
생성/발행/퇴역 시각은 보존한다. 같은 상품 ID·불변 보상 정책·렌더 데이터의 값이 다르면
전체 기본 데이터 실행을 롤백하고 기동을 실패시킨다. 운영 값을 조용히 덮어쓰지 않는다.
정책 변경은 새 revision으로 추가하고, 기본 SQL 변경은 검증 후 manifest 체크섬도 갱신한다.

원본 `build_reward_catalog.py`는 적용된 V134·V136을 재생성하므로 기본 SQL 갱신용으로
실행하지 않는다. 원본 migration은 불변 보존하고 최종 카탈로그 값으로 기본 SQL을 갱신한다.

## 자동 배포의 DB 준비와 동시 교체

새 배포는 Data 이미지에 포함된 `/opt/catus-db/docs/db/deploy-v0.py`를 사용한다.
이 패키지에는 불변 원본 migration, V0, 기본 데이터 SQL과 검증 manifest가 함께 들어 있다.
일회성 `DeploymentMigrationMain`은 Flyway만 실행하며 API·배치·스케줄러를 시작하지 않는다.
배포 호스트가 고정 digest의 이미지에서 패키지를 꺼내 `preflight`와 `apply`를 호출한다.

`preflight`는 DB에 쓰지 않고 대상·계정·PostgreSQL 16·이력·체크섬을 검사해 아래 상태를
반환한다. `apply`는 모든 writer와 Data DB 관측 연결을 중지한 뒤에만 실행한다.

| DB 상태 | 자동 처리 |
|---|---|
| `empty` | 사용자 객체가 없는 DB에 V0와 기본 데이터를 적용한다. 이력 없는 기존 데이터베이스를 빈 DB로 간주하지 않는다. |
| `legacy` | 번들의 원본 migration 이력과 정확히 일치하는 prefix인지 확인하고 전체 custom-format 백업을 만든다. V138 미만이면 불변 원본 체인으로 V138까지 적용하고, V138 구조 지문을 검증한 뒤 V0로 전환한다. |
| `current` | V0부터 시작하는 현재 migration 이력이 번들의 정확한 prefix인지 확인한다. 미적용 migration이 있으면 전체 백업 후 적용하고, 없으면 기본 데이터 콜백을 다시 실행한다. |

현재 번들은 V0와 후속 V1(집중섬 자리 좌표), V2(건물 종류 DB 정본), V3(가상 무인도 목적지), V4(운영 콘텐츠 게시·공지·잡지 검토 테이블), V5(건설 정책 게시 영수증 종류), V6(집중 보상 정책 승인·발행 원장), V7(Outbox 원인 문맥 열), V8(개발자 공지 철회 열), V9(개발자 공지 최소 버전 열)이다. 자동 실행기는 그 체인의
미적용 migration을 처리한다(V0만 적용된 DB는 전체 백업 후 V1·V2·V3·V4·V5·V6·V7·V8·V9를 적용한다). V0 한 행만 있는 DB는 manifest의 구조 지문까지 비교한다.
후속 V1 이상은 불변 이력·체크섬과 Flyway 검증을 사용한다. 이미지보다 새로운 DB,
실패 이력, 체크섬 불일치, 이력 없는 사용자 객체, 지원하지 않는 스키마는 자동 수정하지 않는다.
기존 V125의 핀 만료, V130의 집계 백필, V135·V136의 보상 갱신을 생략하고 V0 이력만 기록하지 않는다.

Data와 Realtime은 **같은 중단 창에서 교체**한다. 새 Data가 제거한 `/api/v1/groups` 대신
새 Realtime은 `GET /internal/users/{userId}/islands`를 호출한다. Data의
`<환경>,satellites,realtime-authorization` 프로파일과 양쪽의 동일한
`SVC_TOKEN_REALTIME_TO_DATA`를 기동 전에 준비한다.

- dev는 Data CI가 같은 main SHA의 두 이미지를 만들고 공동 CD에 digest를 넘긴다.
  해당 push의 위성 배포가 필요하면 먼저 완료를 기다린다. 이미지·runtime·DB 사전 검증 후
  nginx와 Data·Realtime·Business·Notification 및 DB 관측 연결을 중지한다. DB·Redis·Kafka는
  유지한다. 전환 후 두 이미지와 readiness, 기존 위성 복원을 검증한 뒤 트래픽을 재개한다.
  실행 기록·백업과 재실행 방법은 [개발 공동 배포](../../../scripts/README.md#catus-v0-전환과-datarealtime-동시-교체)를 따른다.
- Catus prod는 기존 Infra 실행 구성을 사용한다. 별도 V0 자동 전환 SSM 변경을 요구하지 않는다.
  **최초 전환에서는 운영 호스트에서 nginx·네 앱·Data DB 관측 연결을 중지한 뒤** 같은 Data
  digest의 `deploy-v0.py`를 수동 실행하고, V0 검증이 끝나면 기존 승인 CD로 네 앱을 배포한다.
  최초 발행은 `rebuild_all=true`로 네 이미지를 같은 SHA로 만들며 이후 Data·Realtime 변경은
  두 이미지를 함께 빌드한다. 운영 선행 조건과 최초 전환 순서는
  [운영 배포 문서](../../../../docs/prd/fishcat/server-separation/deployment.md#배포와-롤백)를 따른다.
  운영 DB 실행 기록은 `/opt/catus/runtime/data-v0-db.json`, 백업은
  `/opt/catus/backups/data-v0/`에 보존한다. 기존 SSM 실행기는 이 DB 기록을 읽거나 DB를 전환하지 않는다.

`apply` 실패는 자동 이미지 롤백 조건이 아니다. 예를 들어 V138 보완은 완료됐으나 V0 구조
검증에서 실패할 수 있고, V0 전환 commit 이후 새 앱 readiness가 실패할 수도 있다.
개발 공동 실행기는 트래픽과 writer를 닫아 둔 채 실패 기록을 보존한다. 실제 DB가 `current`이고
트래픽·writer 중지가 확인되면 새 SHA의 수정 이미지로도 재개할 수 있다. 운영 최초 전환은
기존 bootstrap이 실패 시 자동 정지를 보장하지 않으므로 운영자가 nginx·네 앱·Data DB 관측을
다시 중지하고 확인한 뒤 DB 도구 또는 승인 CD를 다시 실행한다. DB 도구를 재실행하면
기록만 믿고 다음 단계로 넘어가지 않고 실제 DB를 다시 분류·검증한다. 이전 일회성 DB
컨테이너가 아직 실행 중이면 재진입을 거부하며, 종료된 경우만 정리 후 진행한다.
백업은 새 파일에 누적하고 덮어쓰지 않는다. 미완료 기록이나 백업을 지워 재시도를 우회하지 않는다.

## V138 → V0 정리와 저수준 검사·복구

`rebase-v0.py`는 자동 실행기가 사용하는 일회성 정리 도구다. 아래 수동 CLI는 계획 검토와
별도 복구 작업용이다. 개발은 공동 CD를, 운영 최초 전환은 위 수동 DB 준비와 기존 승인 CD를 사용한다.

`rebase-v0.py`는 현재 Catus 사용자·로그인 세션·섬·물고기 지갑·정책 데이터를
보존한다. 폐기 테이블은 모두 삭제하고, V48이 생성한 정확한 190개 봇 UUID 중
실제로 남은 계정과 그 구 집중 기록·일간 통계·알림 설정만 정리한다.
기존 `groups`는 행을 다시 생성하지 않고 `ALTER TABLE ... RENAME TO islands`로
이름만 바꾼다. 기존 PK·CHECK·인덱스 이름과 FK 연결, 섬 ID와 데이터는 유지한다.
계획 출력의 `renamed_tables`와 변경 후 테이블 이름으로 행 수를 검증한다.
봇이 현재 서비스 데이터에 연결되어 있으면 전환을 거부한다. FK뿐 아니라
outbox·집계 키·JSON에 들어 있는 사용자/세션 UUID도 확인한다.

상세(`focus_session_details`)가 없는 열린 구 집중 마커는 새 API에서 종료할 수 없고
새 집중 시작·섬 이동을 계속 막으므로 `ended_at=started_at`, `status=AUTO_CLOSED`로
0초 마감한다. 행과 기존 집계는 보존하며 보상을 추가하지 않는다. 상세가 있는 현재
집중 세션은 변경하지 않는다. 폐기한 `LINK` 전달 작업을 삭제한 뒤,
`link.revoked`·`link.joined`·`link.claimConfirmed`·`group.closed`·`group.renamed`·
`user.displayNameChanged` 원본 중 다른 위성 전달 작업이 없는 행만 삭제한다.
공유 `user.withdrawn` 원본과 다른 위성 전달 작업은 보존한다. 계획 출력에 각 대상 건수를 표시한다.

저수준 `rebase-v0.py`는 **V138까지의 검증된 126개 이력과 스키마**에만 적용한다.
낮은 버전의 보완은 위 `deploy-v0.py`가 writer 중지와 백업 후 담당하며, 이 저수준 도구는
이전 migration을 대신 실행하지 않는다. 더 새로운 원본 이력, 체크섬·스키마 차이,
알 수 없는 봇도 자동 보정하지 않는다. V0의 `baseline-on-migrate`는 꺼져 있으므로
기존 DB에 새 API 이미지를 직접 시작하는 방식으로 전환하지 않는다.

지원 범위는 `public` 단일 사용자 스키마다. 다른 사용자 스키마에 객체가 있으면
읽기 전용 계획과 잠금 후 적용 트랜잭션 모두 거부한다. 외부 스키마의 FK가 봇 삭제를
따라 CASCADE되는 상황까지 차단하기 위한 조건이다. PostgreSQL 내부·임시 스키마와
`information_schema`는 제외한다. 외부 객체를 자동으로 삭제하거나 무시하지 않는다.

dev는 현재 Data API DB를 지정한다. prod는 **Catus 2.0 전용 DB**를 지정한다.
이 저장소의 옛 `docker-compose.prod.yml`은 Gromo 1.x용이다. Catus 운영 접속과
실행 구성은 Infra의 `prod/catus/runtime`에서 관리한다. 저수준 `rebase-v0.py`는 비밀 조회,
원격 명령 전송, 배포 또는 서버 재시작을 수행하지 않는다.

PostgreSQL 16의 `psql`, `pg_dump`, `pg_restore`를 사용할 수 있으면 그대로 쓴다.
없으면 Docker의 `postgres:16.14-alpine` 클라이언트를 사용한다. Docker 클라이언트는
`--network host`에서 지정한 DB에 연결한다. macOS의 로컬 호스트 DB에는
`PGHOST=host.docker.internal`을 사용한다. 인증서 파일이나 `.pgpass`가 필요한 환경은
파일에 접근할 수 있는 호스트에서 `--client native`로 실행한다.

```bash
# 대상 환경의 운영 접속 정보를 환경변수로 주입한다. 비밀번호는 명령행 인자에 쓰지 않는다.
export PGHOST=대상_DB_호스트 PGPORT=5432 PGDATABASE=대상_DB PGUSER=운영계정
# PGPASSWORD 또는 호스트의 .pgpass, 필요하면 PGSSLMODE/PGSSLROOTCERT 설정

# 기본 동작: 읽기 전용 계획. DB 식별자·삭제 테이블별 행 수·봇 수를 확인한다.
python3 server/data-api/docs/db/rebase-v0.py --environment dev

# 모든 API·worker·배치와 배포 자동화를 멈춘 뒤 실행한다.
# --confirm에는 출력에서 확인한 실제 환경:DB 이름을 정확히 적는다.
python3 server/data-api/docs/db/rebase-v0.py --environment dev \
  --apply --writers-stopped --confirm "dev:$PGDATABASE" \
  --backup /안전한/백업경로/data-api-before-v0.dump

# prod도 같은 검증·백업·전환 절차다. prod 연결값으로 교체하고 별도 백업 경로를 쓴다.
python3 server/data-api/docs/db/rebase-v0.py --environment prod
python3 server/data-api/docs/db/rebase-v0.py --environment prod \
  --apply --writers-stopped --confirm "prod:$PGDATABASE" \
  --backup /안전한/백업경로/catus-prod-before-v0.dump
```

적용은 전체 custom-format 백업과 백업 목록 검증 후 한 트랜잭션으로 수행한다.
다른 연결, 잠금 획득 실패, 최종 스키마 불일치, 보존 테이블의 예상 행 수 불일치는
전체 전환을 롤백한다. 백업 파일은 권한 0600으로 생성하며 기존 파일을 덮지 않는다.
기존 행 수 검증 후 동일한 `insert.sql`로 기본 데이터 누락을 복구하고 V0 이력을 기록한다.
기본 데이터 충돌도 전체 전환을 롤백한다. 계획에 V0·seed 체크섬과 기본 행 수를 출력한다.
이미 검증된 V0라면 구조 변경 없이 종료하며 기본 행 복구는 앱 기동 콜백이 담당한다.
새 Data와 Realtime을 같은 창에서 기동하고 두 서비스의 health와 실제
회원·섬·집중 흐름을 확인한 다음 다른 writer와 배포 자동화를 재개한다.

백업에는 모든 사용자 정보가 들어 있으므로 운영 백업 저장·접근·보존 정책으로
관리한다. 복구가 필요하면 모든 writer를 멈춘 상태에서 **별도 빈 DB에**
`pg_restore --exit-on-error --dbname=<복구DB> <백업파일>`로 복원하고, 구 이미지로
검증한 뒤 접속 대상을 전환한다. 구 이미지는 V0 DB와 호환되지 않는다. 이미지
롤백만으로 삭제한 테이블이나 구 필드가 복원되지는 않는다.

## 검증과 기준 자료

```bash
python3 server/data-api/docs/db/test-rebase-v0.py
python3 server/data-api/docs/db/test-deploy-v0.py
server/data-api/docs/db/verify-schema-dbml.sh
(cd server/data-api && ./gradlew test --tests 'com.oneorthree.phone.db.*' --tests 'com.oneorthree.phone.common.db.*')
```

빌드한 Data 이미지의 digest로 배포 경로 전체를 로컬에서 재현할 수 있다.
아래 검사는 전용 PostgreSQL 컨테이너·network를 만들고 종료 시 제거한다.
이미지에서 추출한 실행기로 빈 DB·반복 배포·V117→V138→V0(→후속 V1+)·백업 복원,
V0만 적용된 DB의 백업 후 후속 migration 적용·복원, 빈 history 재시도, 잔존 연결 거부,
seed 충돌 롤백과 중단된 컨테이너 처리를 확인한다. 기대 체인은 이미지에 번들된 `db/v0`에서 읽는다.
백업과 검증 JSON은 지정한 artifacts 디렉터리에 남긴다.

```bash
python3 server/data-api/docs/db/test-deploy-v0-integration.py \
  --data-image 'registry/data-api@sha256:<빌드한 이미지의 digest>' \
  --artifacts-dir /tmp/catus-db-deployment-verification
```

`v0-rebase/manifest.json`에는 기존 Flyway 체크섬, 원본/전환 후 스키마 지문,
폐기 대상과 봇 UUID를 고정했다. `retire.sql`·V0·기본 insert.sql의 체크섬도 확인하므로
파일 일부만 수정해 실행할 수 없다. 이 자료와 `rebase-v0.py`는 일회성 V138→V0 전환 전용이다.
추후 V1 이상 스키마에는 저수준 rebase를 재사용하지 않는다. 자동 `deploy-v0.py`는
현재 체인을 인식하고 위 설명대로 후속 migration만 적용한다.

`v0-rebase/schema.sql`은 스키마 생성 SQL이 아니라 비교할 카탈로그를 정렬된 JSON으로
읽는 쿼리다. V138 원본 지문은 `groups`, 전환 후 지문은 `islands`를 기준으로 한다.
스키마 지문은 테이블·컬럼·기본값·제약·인덱스·트리거·함수·RLS·확장을 확인한다.
환경별 소유자와 권한은 변경하지 않는다. PostgreSQL이 덤프를 다시 읽으며 일부
CHECK의 동등한 캐스트 표현을 바꾸므로 기존 전환 결과와 빈 DB 결과의 지문을
각각 고정했다. 백업 복원된 V138도 별도로 검증한 동일 구조 지문만 허용한다. `schema.dbml` 검사는 테이블·컬럼·NULL 허용·FK·ON DELETE를 대조한다.

생성 기준은 `a94e72c0402d97a1a647a6aaa745cb8973e93a38`의 불변 migration 126개와
`postgres:16.14-alpine`이다. 재현은 원격 DB 대신 새 일회성 DB에서 원본 체인을
V138까지 적용하고, 별도 복제본에 `preparation()`·`retire.sql`·승인된 봇 행 정리를
같은 트랜잭션으로 실행한다. 그 결과를 `pg_dump --schema-only --no-owner --no-privileges
--exclude-table=public.flyway_schema_history`로 추출해 V0를 만든다. 기본 SQL은 위
8개 테이블의 최종 345행에서 생성/발행/퇴역 시각을 제외하여 구성한다. 원본 DB와
그 custom-format 백업 복원본의 source 지문, 양쪽 정리 결과와 빈 DB의 V0·콜백 적용
결과의 target 지문을 `schema.sql`로 비교한 뒤 manifest에 기록한다. 마지막으로
V138→V0 CLI 전환·전체 백업 복원과 위 테스트를 검증한다. 이 순서를 재현하더라도
원본 migration과 기존에 적용한 V0를 수정하는 절차로 사용하지 않는다.

과거 로컬 `reset-db.sh`/`setup-dev-db.sh`는 전체 삭제와 Hibernate 자동 생성에
의존하므로 사용하지 않는다. 본 전환 도구와 Flyway V0를 사용한다.

기존 `loadtest/seed`는 폐기된 태그·리그·봇 등 Gromo 데이터 구조를 전제로 하므로
V0와 호환되지 않는다. 경로만 V0로 바꾸어 실행하지 않는다. 현행 스키마에 맞는
seed 정비 전에는 이 부하 테스트 초기화 절차를 사용할 수 없다. loadtest 앱의
Flyway 위치도 V0이므로 기존 원본 migration 체인의 golden DB를 그대로 연결하면 기동하지 않는다.

## 백오피스 선별 release의 V137.1 호환 전환

운영 release의 `V137_1__backoffice_publications.sql`은 main의 V4·V5·V6 효과를 미리 적용한 승인된 확장이다. main 이미지에도 이 파일을 원문 SHA256 `acaea4884a14d0c25ed5039116b4034615c3c7e7327d0622bd267629bfe0e92a` 그대로 보관한다. 기존 V0·V1..6 SQL과 원본 `manifest.json`은 변경하지 않는다.

`v0-rebase/backoffice-profile.json`은 확장 migration checksum/SHA, canonical V1..6 checksum/SHA, 원본·복원본의 정확한 source/중간/final schema 지문을 고정한다. 자동 실행은 원본 history prefix 또는 이 확장의 history prefix만 인식한다. 알려지지 않은 추가 이력·확장 checksum·구조는 중단한다.

- V138 미만 원본: 기존 legacy Flyway가 V137.1과 V138까지 순서대로 적용하고 확장 profile로 전환한다.
- V137.1 선별 운영 DB: 기존 legacy Flyway가 V138만 추가하고 확장 profile로 전환한다.
- 확장 없는 V138: 기존 원본 profile로 V0 전환 후 V1..6을 정상 실행한다. 누락된 V137.1을 out-of-order로 끼워 넣지 않는다.
- 확장 있는 V138: 원본 retirement와 보존 행 수 검증 후 같은 transaction에서 V1..3을 실제 실행한다. 이미 검증된 V4..6 효과를 중복 생성하지 않고 canonical 이력을 기록한 다음 전체 V0..6 지문을 확인하여 commit한다. 실패하면 DDL·이력·보존 데이터 모두 rollback한다. V7 이후 후속 migration은 commit 뒤 `deploy-v0.py`의 current 단계가 일반 Flyway로 적용한다.

검토 snapshot, 공지, 발행 영수증, 정책 승인·발행과 기존 revision은 보존 대상이다. exact source schema를 먼저 확인하며 확장 테이블을 fingerprint에서 제외하지 않는다. 기존 V1 `BASELINE` 이력 허용 조건도 유지한다.

PostgreSQL dump/restore는 동등한 CHECK의 varchar-array/text cast 표현을 정규화한다. 따라서 기존 도구와 마찬가지로 원본 직접 전환·dump 복원본 전환·fresh canonical의 **검증된 세 final 지문만** 허용한다. 통합 테스트는 세 결과를 dump/restore로 동일하게 정규화했을 때 전체 카탈로그 지문이 fresh V0..6과 정확히 같음을 확인한다. 운영 DB의 업무 제약을 임의로 재작성하지 않는다.

`python3 docs/db/test-backoffice-bridge-integration.py`는 기존 DB나 원격 접속 인자를 받지 않고 전용 PostgreSQL 컨테이너 하나를 생성·정리한다. 실제 populated receipt/revision 보존, 원본 및 BASELINE 복원 이력, unknown schema/checksum 거부, 마지막 검증 실패의 전체 transaction rollback, plain V138 경로를 확인한다. `--generate-profile`은 격리 fixture에서 지문을 재생성하는 개발 전용 옵션이며 운영 DB의 지문을 자동 승인하는 기능이 아니다. `DeploymentMigrationMainTest`는 전환 결과에 실제 Flyway validate와 반복 migrate를 실행한다.

Dockerfile의 기존 `COPY docs/db/v0-rebase`와 `COPY src/main/resources/db/migration`가 새 profile 및 원문 확장을 같은 이미지에 포함한다. 별도 호스트 자료나 운영 DB 직접 수정은 필요 없다.

전환 감사증거에는 manifest의 예상 이력을 복사하는 대신 DB에서 읽은 실제 `source_history`의 version/type/script/checksum/success를 보존한다. 최초 V1이 `BASELINE`이면 그 원문과 null checksum도 유지한다. 선택한 source profile·schema 지문, V137.1 확장의 version/script/checksum/SHA256도 기록한다. 비밀번호·연결 문자열·업무 payload는 포함하지 않는다.

수동 rebase의 읽기 전용 계획 출력과 `<backup>.plan.json`이 같은 증거를 담는다. 자동 `deploy-v0.py`는 legacy catch-up을 마친 뒤 이력을 V0..6으로 교체하기 **전에** `<backup>.rebase-plan.json`을 만들고 journal의 `rebase_plan_path`에 위치를 남긴다. 두 sidecar는 0600으로 독점 생성하고 파일·디렉터리를 fsync하며 기존 파일을 덮어쓰지 않는다. 증거 저장에 실패하면 이력 교체를 시작하지 않는다.
