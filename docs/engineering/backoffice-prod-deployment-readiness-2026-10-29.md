# 운영 백오피스 배포 현황 (2026-10-29)

현재 백오피스는 운영에 배포되지 않았다. 화면의 기존 이력 조회 구현은 [GROMO-2563](https://romance.atlassian.net/browse/GROMO-2563)의 `main` 대상 PR에서 검증 중이다. 실제 운영 기록을 확인했다는 뜻이 아니다.

## 확인한 인프라

- GCP `oneorthree2`에는 실행 중인 `gromo-dev-app`, `gromo-dev-build`가 있다. 이 프로젝트에 운영 백오피스 VM이나 AWS VPC 연결용 VPN 터널·게이트웨이는 확인되지 않았다.
- 운영 Data·Notification은 AWS VPC의 `gromo-prod` 호스트 내부 Docker 네트워크에 있다. 공개 웹 경로의 `/internal/**`는 차단된다. 새 GCP VM에서 운영 내부 API로 바로 접근할 수 없다.
- AWS 운영 EC2 `i-0574773709227d341`은 `t4g.medium`이다. 보안 그룹의 외부 진입은 Cloudflare용 80/443이며 SSH는 열려 있지 않다. 별도 작은 EC2도 운영 호스트 내부 Docker 네트워크에는 자동으로 합류하지 않는다.
- 현재 `release`에는 백오피스가 요구하는 Data·Notification 관리 API가 없다. `main` 전체를 `release`로 승격하면 백오피스 외 변경도 대량으로 함께 적용된다. 범위를 먼저 확정하고 릴리스 검증이 필요하다.

## 운영 기록을 보는 데 필요한 순서

1. `main` 대상 운영 이력 PR을 병합하고 Data·Notification 관리 API, DB migration, 환경 표식 설정을 운영 릴리스 범위에 포함한다.
2. 백오피스 호스트에서 두 내부 서비스로 가는 사설 경로를 마련한다. GCP `oneorthree2` VM이면 GCP–AWS 사설망 연결과 AWS 운영 호스트의 내부 API 접근 경로가 모두 필요하다. AWS 운영 VPC의 작은 EC2를 택해도 운영 호스트로 가는 내부 API 경로가 필요하다. 공개 `/internal/**` 개방은 사용하지 않는다.
3. 운영자별 자격, HTTPS 주소, 독립 영구 SQLite 볼륨, 운영 DB 및 FCM 환경 표식을 연결한다. 이 설정 전에는 연결 모드가 시작 또는 조회·발행을 거부한다.
4. 관리 API의 환경 확인을 통과한 뒤 읽기 전용 운영 이력에서 공지·잡지·알림 원장을 확인한다. `SENT`는 기기 화면 표시 증거가 아니고, 탈퇴 시 삭제된 알림 원장 및 정리된 잡지 수신·열람 기록은 복원되지 않는다.

이 문서는 읽기 전용 인프라 조회와 저장소 코드로 확인한 현황이다. VM 생성, 네트워크 변경, 운영 DB 변경, 운영 배포, 운영 발송 및 AWS 부하 테스트는 수행하지 않았다.
