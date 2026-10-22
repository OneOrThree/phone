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
누락된 기본 행을 복구한다. 콜백은 migration 이력을 추가하지 않아 숫자 버전은 0,
`flyway_schema_history`는 V0 한 행으로 유지된다. 원본 SQL을 복사해 별도로 수정하지 않는다.

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

SQL은 하나의 `DO` 문에서 전용 advisory transaction lock과 기본 테이블 잠금을 잡는다.
동시 기동도 직렬화하며, 중복 키는 추가하지 않는다. 기존 건설 비용·발행 포인터와
생성/발행/퇴역 시각은 보존한다. 같은 상품 ID·불변 보상 정책·렌더 데이터의 값이 다르면
전체 기본 데이터 실행을 롤백하고 기동을 실패시킨다. 운영 값을 조용히 덮어쓰지 않는다.
정책 변경은 새 revision으로 추가하고, 기본 SQL 변경은 검증 후 manifest 체크섬도 갱신한다.

원본 `build_reward_catalog.py`는 적용된 V134·V136을 재생성하므로 기본 SQL 갱신용으로
실행하지 않는다. 원본 migration은 불변 보존하고 최종 카탈로그 값으로 기본 SQL을 갱신한다.

## 기존 dev/prod 전환

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

이 도구는 **V138까지의 검증된 126개 이력과 스키마**에만 적용한다. 낮은 버전, 더 새로운
버전, 체크섬 차이, 스키마 차이, 알 수 없는 봇은 자동 보정하지 않는다. V0에서
`baseline-on-migrate`는 꺼져 있으므로 기존 DB에 새 이미지를 먼저 시작하면
실패한다. 먼저 쓰기를 중지하고 아래 전환을 수행한 뒤 새 이미지를 시작한다.

V117~V137 DB는 **먼저 기존 runtime과 불변 `db/migration` 체인으로 V138까지 적용**한다.
V125의 핀 만료 변경과 V130의 주간 집중 집계 백필, V135·V136 보상 갱신을 건너뛰고
V0 이력만 기록하면 안 된다. V138 적용·검증을 마친 뒤 모든 writer를 중지하고 아래
전환을 수행한다. 이 도구는 이전 버전의 migration을 대신 실행하지 않는다.

지원 범위는 `public` 단일 사용자 스키마다. 다른 사용자 스키마에 객체가 있으면
읽기 전용 계획과 잠금 후 적용 트랜잭션 모두 거부한다. 외부 스키마의 FK가 봇 삭제를
따라 CASCADE되는 상황까지 차단하기 위한 조건이다. PostgreSQL 내부·임시 스키마와
`information_schema`는 제외한다. 외부 객체를 자동으로 삭제하거나 무시하지 않는다.

dev는 현재 Data API DB를 지정한다. prod는 **Catus 2.0 전용 DB**를 지정한다.
이 저장소의 옛 `docker-compose.prod.yml`은 Gromo 1.x용이다. Catus 운영 접속과
실행 구성은 Infra의 `prod/catus/runtime`에서 관리한다. 이 도구는 비밀 조회,
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
새 V0 이미지를 기동해 health와 실제
회원·섬·집중 흐름을 확인한 다음 다른 writer와 배포 자동화를 재개한다.

백업에는 모든 사용자 정보가 들어 있으므로 운영 백업 저장·접근·보존 정책으로
관리한다. 복구가 필요하면 모든 writer를 멈춘 상태에서 **별도 빈 DB에**
`pg_restore --exit-on-error --dbname=<복구DB> <백업파일>`로 복원하고, 구 이미지로
검증한 뒤 접속 대상을 전환한다. 구 이미지는 V0 DB와 호환되지 않는다. 이미지
롤백만으로 삭제한 테이블이나 구 필드가 복원되지는 않는다.

## 검증과 기준 자료

```bash
python3 server/data-api/docs/db/test-rebase-v0.py
server/data-api/docs/db/verify-schema-dbml.sh
(cd server/data-api && ./gradlew test --tests 'com.oneorthree.phone.db.*')
```

`v0-rebase/manifest.json`에는 기존 Flyway 체크섬, 원본/전환 후 스키마 지문,
폐기 대상과 봇 UUID를 고정했다. `retire.sql`·V0·기본 insert.sql의 체크섬도 확인하므로
파일 일부만 수정해 실행할 수 없다. 이 자료는 일회성 V138→V0 전환 전용이다.
추후 V1 이상 스키마에는 이 도구를 재사용하지 않는다.

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
