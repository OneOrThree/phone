# CI 최적화 원격 검증 기록

[구현 PR #759](https://github.com/OneOrThree/phone/pull/759)의 자동 CI 결과다.
구현·로컬 검증·기존 실행 기록은 [기술 기록](https://github.com/OneOrThree/phone/blob/c1b226bee3a276f70d8366911460d30c0c5a7e96/docs/engineering/ci-build-reuse/README.md)에 있다.

## 실행별 결과

| Workflow | 결과 | HEAD | 실행 |
| --- | --- | --- | --- |
| Business · Notification CI | queued | `c1b226bee` | [#34749088064](https://github.com/OneOrThree/phone/actions/runs/34749088064) |
| CI | queued | `c1b226bee` | [#34749088125](https://github.com/OneOrThree/phone/actions/runs/34749088125) |
| Realtime CI | queued | `c1b226bee` | [#34749088170](https://github.com/OneOrThree/phone/actions/runs/34749088170) |

**수집 시점에 CI가 진행 중이다. 대기 중인 잡과 아직 배정되지 않은 잡은 소요 시간을 확정하지 않았다.**

수집 시각(UTC): 2026-09-13T09:12:44.709687+00:00, 2026-09-13T09:12:45.781293+00:00, 2026-09-13T09:12:46.807585+00:00

## 잡별 러너 대기와 실행

| Workflow / 잡 | 대기(초) | 실행(초) | 결과 |
| --- | ---: | ---: | --- |

이 HEAD의 JAR 전달과 이미지 조립 단계는 아직 완료되지 않았다.

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
