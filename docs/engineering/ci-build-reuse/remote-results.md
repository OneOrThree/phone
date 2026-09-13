# CI 최적화 원격 검증 기록

[구현 PR #759](https://github.com/OneOrThree/phone/pull/759)의 자동 CI 결과다.
구현·로컬 검증·기존 실행 기록은 [기술 기록](https://github.com/OneOrThree/phone/blob/c1b226bee3a276f70d8366911460d30c0c5a7e96/docs/engineering/ci-build-reuse/README.md)에 있다.

## 실행별 결과

| Workflow | 결과 | HEAD | 실행 |
| --- | --- | --- | --- |
| Business · Notification CI | success | `c1b226bee` | [#34749088064](https://github.com/OneOrThree/phone/actions/runs/34749088064) |
| CI | success | `c1b226bee` | [#34749088125](https://github.com/OneOrThree/phone/actions/runs/34749088125) |
| Realtime CI | success | `c1b226bee` | [#34749088170](https://github.com/OneOrThree/phone/actions/runs/34749088170) |

수집 시각(UTC): 2026-09-13T12:14:41.588464+00:00, 2026-09-13T12:14:42.818665+00:00, 2026-09-13T12:14:43.742576+00:00

## 잡별 러너 대기와 실행

| Workflow / 잡 | 대기(초) | 실행(초) | 결과 |
| --- | ---: | ---: | --- |
| Business · Notification CI / 위성 변경 입력 판정 | 29 | 12 | success |
| Business · Notification CI / 서비스별 시크릿 · DB 격리 | 30 | 98 | success |
| Business · Notification CI / 공개 명령 원자성 · 계약 | 29 | 237 | success |
| Business · Notification CI / notification 검증 | 17 | 601 | success |
| Business · Notification CI / business-api 검증 | 580 | 535 | success |
| Business · Notification CI / notification 이미지 | 1028 | 102 | success |
| Business · Notification CI / business-api 이미지 | 3284 | 107 | success |
| CI / test / gradle | 995 | 1177 | success |
| CI / checkstyle / gradle | — | — | 이전 성공 재사용 |
| CI / spotbugs / gradle | — | — | 이전 성공 재사용 |
| CI / Dev 이미지 build · cache | 403 | 90 | success |
| CI / Dev CD | — | — | skipped |
| CI / pr-report | — | — | skipped |
| Realtime CI / build / gradle | 1163 | 506 | success |
| Realtime CI / 채팅 이미지 build · cache | 1213 | 70 | success |

## JAR 전달과 이미지 조립 단계

| Workflow / 잡 / 단계 | 실행(초) | 결과 |
| --- | ---: | --- |
| Business · Notification CI / notification 검증 / Run ./.github/actions/ci-jar | 11 | success |
| Business · Notification CI / business-api 검증 / Run ./.github/actions/ci-jar | 10 | success |
| Business · Notification CI / notification 이미지 / Run ./.github/actions/ci-jar | 34 | success |
| Business · Notification CI / notification 이미지 / 이미지 검증 · 환경별 digest 발행 | 34 | success |
| Business · Notification CI / business-api 이미지 / Run ./.github/actions/ci-jar | 25 | success |
| Business · Notification CI / business-api 이미지 / 이미지 검증 · 환경별 digest 발행 | 49 | success |
| CI / test / gradle / Run ./.github/actions/ci-jar | 13 | success |
| CI / Dev 이미지 build · cache / Run ./.github/actions/ci-jar | 41 | success |
| CI / Dev 이미지 build · cache / 이미지 빌드 및 push | 24 | success |
| Realtime CI / build / gradle / Run ./.github/actions/ci-jar | 12 | success |
| Realtime CI / 채팅 이미지 build · cache / Run ./.github/actions/ci-jar | 35 | success |
| Realtime CI / 채팅 이미지 build · cache / Build image | 8 | success |

원본 필드·타임스탬프·step 상태·수집 시각은 [actions-after.json](evidence/actions-after.json)에 보관한다.
`queued`와 생략 잡의 대기 시간을 0초로 계산하지 않는다.

## 해석 범위

이번 PR은 공통 CI 파일을 변경했으므로 네 서비스 전체 검사 대상이다.
Data-only PR에서 위성 self-hosted 잡을 생략하는 효과를 직접 측정한 실행은 아니다.
그 경로는 실제 스택 diff 재현과 회귀 테스트로 확인했으며 구현 문서에 별도로 기록했다.
#753 재현 입력을 정확히 구분하면 Data API 소스와 실시간 인가 계약 문서다. `server/realtime/` 서비스 소스 변경은 없다.
기존 실행과 원격 러너 부하·캐시 상태가 다르므로 전체 CI 시간의 차이를 최적화 단독 효과로 주장하지 않는다.
이미지 단계의 Gradle 재실행 제거와 같은 실행 JAR 전달 성공 여부를 따로 확인한다.

## 성과 서술에 사용할 수 있는 근거

- 작업 타임스탬프로 러너 대기와 실행을 구분해 병목을 진단했다.
- 검증된 JAR를 서비스·revision·run ID·SHA-256으로 식별해 이미지에 재사용했다.
- 변경 입력별 검증 범위를 나누면서 계약 검사와 기존 체크 이름을 유지했다.
- 로컬 검증과 GitHub 자동 CI 결과를 분리해 원본 근거를 보관했다.
- 시간 단축률은 동등한 부하·캐시 조건의 반복 측정 전에는 확정하지 않는다.

## 원격 산출물·캐시 증거

[remote-artifact-proofs.json](evidence/remote-artifact-proofs.json)에 네 서비스의 manifest와 이미지 잡 URL, 원본 로그 해시를 보관한다.
검사 잡과 이미지 잡에서 출력한 manifest의 서비스·검증 revision·run ID·JAR SHA-256이 일치한다.
이미지 잡 로그에는 Gradle bootJar 재실행이 없고, registry cache export가 확인됐다.
API의 PR head SHA와 실제 checkout한 merge revision은 서로 다를 수 있으므로 각각 기록한다.

## 최초 실행의 실패와 재실행

최초 HEAD `d0686e452eb607f7fb583912ea983554d933f04e`에서는 Realtime 전체 CI와 Data·Notification 검사가 통과했다.
[Business 검증 잡](https://github.com/OneOrThree/phone/actions/runs/34746293666/job/103694750334)은 러너 이름과 실행 step 없이 실패했다.

> The job was not started because it repeatedly failed to be acquired (5 attempts).

실패한 검사가 통과했다고 처리하지 않았다. failed-only 재실행 요청은 HTTP 502를 반환했지만 원격 run_attempt는 3으로 진행돼 실제 API 상태를 다시 조회했다.
GitHub가 이전 성공 잡에 새 check 생성 시각과 과거 시작·완료 시각을 함께 반환하는 것을 발견했다.
측정기는 이런 기록을 이전 성공 재사용으로 표시하고 이번 대기·실행 시간에서 제외한다. 실제 응답 시각을 회귀 테스트로 추가한 후 전체 Python 79건이 통과했다.
미배정 취소 잡은 완료 시각이 생성보다 1초 앞서는 별도 이상치도 있었다. 성공 여부와 러너 배정을 확인해 이를 과거 성공 재사용으로 오분류하지 않도록 보완했다.
이 보정 커밋을 push해 새 CI를 시작했으며, 이전 실행 기록과 최종 HEAD의 검증 결과를 구분해 보관한다.
로컬 `gh run watch`의 네트워크 timeout도 원격 CI 실패와 구분했다. 결과는 GitHub 실행·잡 API와 완료 로그로 판정하며 진행 중인 실행을 통과로 처리하지 않는다.
최초 실행·실패 annotation·재사용 check 원본은 evidence의 initial-* 파일에 보관한다.

최초 Realtime 이미지 잡은 JAR 다운로드·검증 31초, 이미지 빌드 단계 34초로 완료됐다.
[initial-realtime-proof.json](evidence/initial-realtime-proof.json)에 검사 잡과 이미지 잡의 동일 manifest, registry cache export 관측, 이미지 잡 URL과 로그 SHA-256을 기록했다.
이는 최초 HEAD의 1회 관측이며 현재 HEAD의 전체 성공이나 일정한 시간 단축률을 뜻하지 않는다.

## 최종 HEAD의 Data 타임아웃과 재검증

HEAD `c1b226bee`의 첫 Data 실행은 30분 제한을 넘어 취소됐다. 제한과 검사 항목을 그대로 유지하고 실패 잡만 재실행했다.
취소된 실행에서 저장된 XML 81개에는 테스트 834건, 실패·오류 0건, 생략 1건이 있다. 이는 일부 결과이며 전체 통과가 아니다.
09:49:37 UTC에 같은 VM의 3번 러너에서 OOM kill이 발생했고, Data 로그에는 housekeeper 지연 4분 1.978초 경고가 남았다.
공유 자원 압박과 일치하는 관측이며, Data 단일 잡의 메모리 사용량을 프로파일링하거나 정확한 인과 기여도를 측정한 것은 아니다.
Data를 GitHub-hosted로 상시 이전하는 방안도 검토했으나 기존 workflow가 명시한 월 사용량 제약을 보존해 러너 배치를 변경하지 않았다. 조회 시 3번 러너는 OOM 종료 후 offline 상태였으며 인프라 설정은 변경하지 않았다.
[data-timeout-evidence.json](evidence/data-timeout-evidence.json)에 일부 테스트 수·실패 annotation·OOM 시각·로그 해시를 보관한다.
[actions-before-data-retry.json](evidence/actions-before-data-retry.json)은 재실행 전 전체 상태이며, 상단 표와 actions-after.json은 최신 시도 결과다.
Business·Notification·Realtime은 같은 HEAD에서 전체 검사와 이미지 조립을 통과했다. [three-service-proofs.json](evidence/three-service-proofs.json)에 세 서비스의 검사→이미지 manifest 일치, Gradle builder RUN 없음, registry cache export를 기록했다.

## Data 재실행의 완료 결과

시도 2의 [검사 잡](https://github.com/OneOrThree/phone/actions/runs/34749088125/job/103716725426)이 성공했다. 이번 잡의 시작·완료 사이에 생성된 `test-results` 아티팩트 ID `10317631805`를 지정해 집계했다.
XML 248개에서 테스트 2631건, 실패 0건, 오류 0건, 생략 8건을 확인했다.
[data-final-test-evidence.json](evidence/data-final-test-evidence.json)에 잡·아티팩트 ID, 생성 시각, ZIP SHA-256과 집계를 보관한다. 첫 시도의 일부 결과와 합산하지 않았다.
재실행 성공은 이 revision의 검사 결과다. 서버 부하가 달라졌으므로 첫 시도 대비 시간 차이를 CI 최적화 단독 효과로 계산하지 않는다.

## 스택 병합 후 이력 정리

#751 squash merge 뒤 #752를 main으로 맞추는 과정에서 충돌 5곳을 처리하고 #753에 전파했다.
main과 머지된 #751의 서비스 파일은 같았으며 차이는 #740 문서 6개였다. 충돌 위치의 main blob이 #751 조상 blob과 같음을 확인해 후속 PR 구현을 보존했다.
정리 전후의 네 서비스·Dockerfile·CI 입력 tree가 기존 전체 검증본과 같고 최종 파일 차이가 해당 문서 6개뿐임을 확인했다.
이력 정리 push도 자동 CI를 다시 만들므로, 스택 유지 작업 자체가 공유 러너 대기에 영향을 줄 수 있다. 이 작업의 추가 대기 시간을 최적화 효과로 계산하지 않는다.
[stack-merge-repair.json](evidence/stack-merge-repair.json)에 고정 SHA, 충돌 경로, 검증 tree·로그·이미지 ID 근거를 남겼다.
