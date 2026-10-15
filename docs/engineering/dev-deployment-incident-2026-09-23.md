# dev 배포 장애 및 복구 기록 — 2026-09-23

기준 시간대는 KST입니다. 시크릿 값, DB 비밀번호, 서비스 토큰은 기록하지 않았습니다. 상세 실행 로그는 각 GitHub Actions 링크에서 확인할 수 있습니다.

## 실행 이력

| 실행 | 결과와 확인 사항 |
| --- | --- |
| [Satellite Dev CD #35796884245](https://github.com/OneOrThree/phone/actions/runs/35796884245) | Secrets Manager 키 누락, Notification 호출 토큰 형식 오류, `POSTGRES_DB`를 시크릿 충돌로 오판한 오류를 차례로 확인했습니다. |
| [PR #940](https://github.com/OneOrThree/phone/pull/940) | `POSTGRES_DB`를 공개 설정 키로 분류하는 수정을 병합했습니다. |
| [Business·Notification CI #35802120482](https://github.com/OneOrThree/phone/actions/runs/35802120482) | 통과했습니다. |
| [Satellite Dev CD #35802515752](https://github.com/OneOrThree/phone/actions/runs/35802515752) | 이미지 배포까지 성공했으나 09:38경 서비스 health check에서 실패했습니다. |
| [PR #942](https://github.com/OneOrThree/phone/pull/942) | Business 이미지의 Datadog agent JAR 권한 문제를 수정하고 병합했습니다. |
| [Satellite Dev CD #35805039424](https://github.com/OneOrThree/phone/actions/runs/35805039424) | VM 과부하로 health check가 지연되어 취소했습니다. 배포한 Business·Notification 이미지는 이후 순차 기동으로 검증했습니다. |
| [Satellite Dev CD #35809887406](https://github.com/OneOrThree/phone/actions/runs/35809887406) | 배포 준비 단계에서 공유 `dev.env` 부재를 확인했습니다. Secrets Manager에서 파일을 다시 생성했습니다. |
| [Satellite Dev CD #35810931788](https://github.com/OneOrThree/phone/actions/runs/35810931788), [#35811284865 1차](https://github.com/OneOrThree/phone/actions/runs/35811284865/attempts/1) | 두 JVM 서비스가 5분 health 제한을 넘겨 실패했습니다. 두 서비스는 약 5~7분 뒤 실제로 `healthy`가 됐습니다. |
| [Satellite Dev CD #35811284865 2차](https://github.com/OneOrThree/phone/actions/runs/35811284865/attempts/2) | 동일 이미지로 재실행해 **성공**했습니다. |

## 원인과 복구

1. Business 컨테이너는 `/opt/dd-java-agent.jar`가 `0600 root:root`인 상태에서 `USER business`로 실행되어 JVM 시작 전에 종료했습니다. [PR #942](https://github.com/OneOrThree/phone/pull/942)의 이미지 권한 수정 후 `/health` 200과 Docker `healthy`를 확인했습니다.
2. Notification은 `gromo_notification` DB가 없어 `FATAL: database "gromo_notification" does not exist`로 종료했습니다. 기존 Data API는 관리자 계정으로 `dev` DB를 사용 중이어서 계정부터 분리했습니다. 작업 전에 `/var/backups/gromo/dev-2026-09-23-before-notification.dump`에 `pg_dump -Fc` 백업을 만들고 `pg_restore -l`로 형식을 확인했습니다. 파일 권한은 `0600`입니다.
3. AWS Secrets Manager `gromo/dev/env`에 Data·Notification의 별도 DB 접속 정보를 저장했습니다. 기존 JWT 값과 관리자 자격은 변경하지 않았습니다. `dev` DB의 소유권과 앱 객체 소유권을 비관리자 `gromo_data`로 옮기고, 전용 `gromo_notification` 역할과 DB를 생성했습니다. 두 역할에 관리자 권한이 없고 서로의 DB에 연결할 수 없음을 확인했습니다.
4. Data API는 `dev,satellites` 프로필과 `gromo_data` 계정으로 재기동했습니다. Notification은 전용 DB에 Flyway 마이그레이션 7개를 적용해 테이블 24개를 생성했습니다. VM 메모리 압박으로 SSH와 공개 health가 응답하지 않던 구간에는 VM을 재설정한 뒤 서비스를 순서대로 기동했습니다.
5. Realtime은 Redis DNS·TCP·`PING`이 정상인데도 `RedisCommandTimeoutException: Connection initialization timed out after 2 second(s)`로 반복 종료했습니다. VM의 동시 JVM 기동 부하를 확인하고 Realtime에 연결 5초·명령 10초 설정을 적용해 readiness 200과 Docker `healthy`를 검증했습니다.
6. Kafka의 기존 health 명령은 매번 JVM을 실행해 부하 중 10초 제한에 걸렸습니다. 브로커에 직접 ApiVersions 요청을 보내는 경량 검사는 같은 시점에 약 0.3~0.8초에 응답했습니다. 반복 기동이 멈춘 뒤 기존 검사도 `healthy`로 돌아왔습니다.

## 최종 확인과 남은 작업

2026-09-23 12:21 KST 기준 공개 Data API [`/health`](https://oneorthree.dev.mooo.com/health)는 HTTP 200이고, Business·Notification·Realtime·Kafka·PostgreSQL·Redis는 Docker `healthy`였습니다. [Satellite Dev CD #35811284865 2차](https://github.com/OneOrThree/phone/actions/runs/35811284865/attempts/2)도 성공했습니다.

[PR #958](https://github.com/OneOrThree/phone/pull/958)에 CD health 대기 15분, Kafka 경량 검사, dev Realtime Redis 제한을 영구 설정으로 올렸습니다. PR 병합 전까지 VM의 Realtime은 `/opt/actions-runner/_work/phone/.gromo-runtime/realtime-timeout.override.yml`의 임시 Compose 오버레이를 사용합니다. PR 배포 때 Kafka 컨테이너 재생성 후 데이터 볼륨과 health 상태를 확인해야 합니다.
