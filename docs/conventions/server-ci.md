# 서버 CI 검사와 이미지 입력

서비스별 Gradle `build`(`be-gradle.yml`)는 실행마다 테스트·정적 검사·bootJar 생성을 한다.
`ci-jar`는 같은 Actions 실행 ID·SHA·서비스·checksum으로 JAR를 검증하고, 그 JAR를 dev V2 이미지에 넣는다(`JAR_SOURCE=prebuilt`).
운영 발행은 `ci-jar`를 쓰지 않는다. `.github/scripts/v2/prod/catus-runtime-V2.py`의 `publish`가 Docker 안에서 Gradle `bootJar`를 다시 돌려 arm64 이미지를 만든다(Dockerfile 기본값 `JAR_SOURCE=builder`).
다른 실행의 JAR나 PR 검사 결과를 운영 발행에 재사용하지 않는다.

전체 파이프라인은 [dev V2](../engineering/dev-v2-pipeline.md)와 [prod V2](../engineering/prod-v2-pipeline.md) 문서를 본다. 경로별로 무엇이 도는지는 [파이프라인 지도](../engineering/pipeline-map.md)를 본다.

| 단계 | Gradle·JAR 책임 | 이미지 검사·발행 |
|---|---|---|
| main 대상 PR | `data-api-ci.dev-v2`가 돌면 Data·Realtime Gradle을 항상 함께 돈다. `satellite-ci.dev-v2`는 변경 서비스만 돈다. `prod-ci-V2`도 변경 서비스의 Gradle을 돈다(Data·Realtime은 묶음). Realtime을 바꾸면 Realtime Gradle이 3번 돈다: `realtime-ci.dev-v2`의 자체 PR 트리거, `data-api-ci.dev-v2`의 호출, `prod-ci-V2` | 발행 없음 |
| release 대상 PR | 같은 저장소 main → release 승격 PR은 서비스별 Gradle을 건너뛴다(`pr-ci-policy.py`의 `full-checks=false`). 그 밖의 release 대상 PR은 `prod-ci-V2`에서 변경 서비스별로 돈다 | 발행 없음 |
| main push | dev V2 서비스 CI에서 최종 main SHA 검사 | 같은 실행의 `ci-jar` JAR로 dev amd64 발행, Auto CD 배포 |
| release push·수동 발행 | `prod-ci-V2`에서 운영 상태 대비 변경 서비스 검사 | Docker 안에서 다시 빌드해 운영 arm64 발행. 운영 배포는 `prod-cd-V2` |

main 대상 PR의 `prod-ci-V2`는 운영 계획·계약 검사 뒤 변경 서비스의 Gradle도 돈다(`prod-ci-V2.yml`의 `checks` 잡).
PR의 SHA와 main/release 최종 SHA는 달라질 수 있으므로 단계 사이의 검사는 생략하지 않는다.

## 최신 대기 실행과 누적 배포 변경

dev V2는 마지막 성공 상태의 서비스별 지문으로 누적 변경을 판정한다.
`cd-auto.dev-v2.yml`이 최신 main 기준으로 필요한 CI 산출물을 확인하고 런타임·앱 CD를 조정한다.
성공한 CI를 실제 배포 성공으로 간주하지 않으며, GCS 성공 상태·호스트 저널·health를 대조한다.
구 단일 VM의 Satellite CD·`dev-vm-deploy` 큐는 제거했다.
