# 서버 CI 검사와 이미지 입력

서비스별 Gradle `build`는 테스트·정적 검사·bootJar 생성을 한 번 수행한다.
`ci-jar`는 동일 Actions 실행 ID·SHA·서비스·checksum으로 JAR를 검증하며,
다른 실행의 JAR나 PR 검사 결과를 운영 발행에 재사용하지 않는다.

| 단계 | Gradle·JAR 책임 | 이미지 검사·발행 |
|---|---|---|
| main 대상 PR | Data·Realtime·Satellite 서비스 CI에서 변경 서비스별 1회 | 같은 JAR로 dev amd64 및 운영 arm64 조립 검증. 발행 없음 |
| release 대상 PR | prod-ci에서 변경 서비스별 1회 | 운영 arm64 조립 검증. 발행 없음 |
| main push | dev 서비스 CI에서 최종 main SHA 검사 | dev amd64 발행·배포 |
| release push·수동 발행 | prod-ci에서 운영 상태 대비 변경 서비스 검사 | 운영 arm64 발행. 운영 배포는 기존 CD 경로 |

main 대상 PR의 prod-ci는 운영 계획·계약 검사만 수행한다. prod-ci.yml이나
공통 arm64 검증 액션이 바뀌면 서비스 CI도 시작되어 실제 이미지 조립을 검증한다.
PR의 SHA와 main/release 최종 SHA는 달라질 수 있으므로 단계 사이의 검사는 생략하지 않는다.
