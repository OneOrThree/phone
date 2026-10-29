# 백오피스 서버 기능의 선별 운영 승격

이번 선별 배포는 `release-backoffice/GROMO-2595`에서 필요한 Data·Notification API, Business 공지 조회, 공유 환경 설정·계약 검사만 모아 `release`로 승격한다. 백오피스 앱은 별도 `backoffice-vX.Y.Z` 릴리스로 배포한다. main 전체 변경을 포함하지 않는다.

`release/backoffice-GROMO-2595`는 기존 `release` Git ref와 파일/디렉터리 충돌로 공존할 수 없어 `release-backoffice/GROMO-2595`를 사용한다.

## 승격 조건

`catus-version.py`는 이번 브랜치 이름만 예외로 허용한다. 다른 feature·release 브랜치는 기존처럼 거부한다. GitHub PR이 병합된 release 대상 PR이고 merge SHA가 검사 대상 커밋과 일치해야 하며, 다음을 모두 확인한다.

1. head/base repository full_name이 현재 저장소이고 양쪽 숫자 repository ID가 같아야 한다. fork와 불완전한 저장소 식별자는 거부한다.
2. head SHA는 40자리 hex이고, 병합 커밋의 **정확한 두 번째 부모**여야 한다. 부모가 둘이 아닌 squash·rebase·octopus merge는 거부한다.
3. `release:major`, `release:minor`, `release:patch` 중 **정확히 하나**의 버전 라벨이 있어야 한다.
4. 병합 결과 tree가 검토한 head tree와 같아야 한다. 운영 release가 앞섰다면 먼저 선별 브랜치에 반영하고 재검토한다. 병합 과정에서 별도 수정하지 않는다.
5. 병합 커밋의 첫 부모 대비 전체 변경 경로를 검사한다. rename을 꺼서 이동 전 경로 삭제도 검사하며, 허용 범위 밖 경로는 하나라도 있으면 거부한다.

허용 범위는 `server/data-api/**`, `server/notification/**`, `server/business-api/**`와 아래 명시 파일뿐이다.

- `.github/scripts/write-compose-env.py`, `test_write_compose_env.py`, `test_config_contract.py`
- `.github/scripts/check-satellite-contracts.py`
- `.github/scripts/catus-version.py`, `test_catus_version_badges.py`, `test_catus_selective_version.py`
- `docs/contracts/notification-admin-api.yaml`, `docs/contracts/business-satellite-api.yaml`
- `server/scripts/nginx-satellites.include.conf.example` — 기존 `/me` Business 라우팅의 개발자 공지 경로 명시
- `docs/engineering/backoffice-selective-release.md`

`backoffice/`, `app/`, `server/realtime/`, 일반 workflow·배포 인프라 변경은 이 예외에 포함되지 않는다. 경로 허용은 개별 코드 변경의 승인을 대신하지 않으며 해당 서버 PR의 코드 리뷰·테스트는 여전히 필요하다. main → release의 기존 버전 계산과 main 부모 이력 보존 검사는 유지한다.

## 검증·운영 순서

RDS에서는 데이터베이스 소유자와 `rds_superuser`가 `ALTER DATABASE ... SET gromo.*`를 실행할 수 없다. 운영 배포 전 각 DB의 설명이 비어 있는지 확인하고, DB 소유자 자격으로 아래 표식을 설정한다. 기존 `pg_db_role_setting` 표식이 있으면 서버가 그것을 우선 검증하며, 하나라도 불완전하거나 불일치하면 설명 표식으로 우회하지 않는다. 설명은 다른 용도로 덮어쓰지 않는다.

```sql
COMMENT ON DATABASE catus_data IS 'gromo.environment=prod';
COMMENT ON DATABASE catus_notification IS 'gromo.environment=prod;gromo.fcm_project_id=catus-prod';
```

Data의 환경 API와 Notification의 환경 API가 각각 `prod` 및 `catus-prod`를 반환하는지 확인한 뒤 백오피스를 공개한다. Notification은 같은 검사를 기존 FCM 발송 직전에도 실행한다. 복구 시에는 원래 설명이 비어 있었던 운영 DB에서만 `COMMENT ON DATABASE ... IS NULL`로 표식을 지울 수 있다.

격리 DB에서 선별 SQL 적용과 후속 main DB 전환 호환성을 검증한다. 필요한 서버 기능 PR과 선별 승격 PR을 검토한 뒤 운영자가 Create a merge commit으로 병합한다. 기존 prod CI/CD로 서버를 배포하고 인증된 API 환경·계약·이력을 확인한 다음 독립 백오피스를 배포한다. 운영 데이터의 실제 발송·게시를 배포 테스트에서 실행하지 않는다. AWS 부하 테스트와 부하 데이터 생성은 금지한다.

`prod-ci.yml`의 `test_catus*.py` discovery가 신규 `test_catus_selective_version.py`를 포함한다. 테스트는 임시 Git 저장소에 실제 두 부모 merge와 squash·변경 tree를 만들고 GitHub API 응답만 대체한다.
