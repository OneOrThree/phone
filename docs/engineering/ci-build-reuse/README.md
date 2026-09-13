# CI 중복 빌드와 공유 러너 대기 개선

- 작업: [GROMO-1800](https://romance.atlassian.net/browse/GROMO-1800)
- 작성일: 2026-09-13 (KST)
- 구현 기준: `ebdaa4074dbee938b2ce76801a9f5f76cdafdff6` (설정 PR #747 squash merge)
- 범위: Data dev CI, Realtime CI, Business·Notification CI, 네 서비스 Dockerfile
- 관련 작업: 티켓 1793의 가벼운 검사 러너 분리 이후 남은 중복 작업

## 문제와 측정 근거

“이미지 빌드가 느리다”는 관찰을 러너 대기와 실제 실행으로 나눠 조사했다.
GitHub Actions Jobs API의 `created_at → started_at`을 대기,
`started_at → completed_at`을 실행으로 계산했다. 실행에는 checkout·캐시·정리가 포함된다.
`queued` 응답이 `started_at=created_at`을 반환해도 러너가 배정되지 않았으면 대기는 미확정(null)으로 둔다.

### 변경 전 실제 기록

동일한 #747 HEAD `303c925b17716fe1c6bb07216ba2abcee5eb7efc`의 두 실행이다.

| 작업 | 러너 대기 | 잡 실행 | 원본 |
| --- | ---: | ---: | --- |
| Notification 이미지 | 46분 01초 | 4분 21초 | [위성 CI](https://github.com/OneOrThree/phone/actions/runs/34741165860) |
| Business 이미지 | 62분 05초 | 4분 21초 | [위성 CI](https://github.com/OneOrThree/phone/actions/runs/34741165860) |
| Data 테스트 | 20분 06초 | 27분 38초 | [Data CI](https://github.com/OneOrThree/phone/actions/runs/34741166019) |
| Data 이미지 | 43분 06초 | 7분 29초 | [Data CI](https://github.com/OneOrThree/phone/actions/runs/34741166019) |

이전 위성 실행에서도 Notification 이미지는 대기 38분 51초/실행 3분 53초,
Business 이미지는 대기 57분 34초/실행 4분 04초였다.
[이전 실행](https://github.com/OneOrThree/phone/actions/runs/34693066138)

원본 타임스탬프·step·revision·run attempt는 [actions-before.json](evidence/actions-before.json)에 보관한다.
CI 호스트 사양 조회 결과는 `e2-custom-4-8192`(4 vCPU·8 GiB), 같은 VM의 CI 러너 3개가 모두 busy였다.
단일 시점 관측이며 지속적인 CPU 사용률·메모리 프로파일을 수집한 결과는 아니다.

### 원인 구분

1. 실제 연산 자원은 VM 한 대인데 러너 3개와 여러 스택 PR의 작업이 경쟁했다.
2. Gradle 검사 잡이 만든 JAR를 전달하지 않아 Docker builder가 `bootJar`를 다시 실행했다.
3. Data 변경만으로 위성 workflow가 시작돼도 Business·Notification 전체 검사와 이미지 2개가 모두 실행됐다.
4. Data·Realtime에는 GAR 외부 캐시가 있었지만 Business·Notification 이미지에는 없었다.

이번 변경은 2~4번을 줄인다. 서버 증설, 러너 프로세스 추가, 테스트 포크 수 증가는 하지 않는다.
대기 시간이 길다는 관측만으로 이번 변경의 전체 소요 시간 단축률을 미리 주장하지 않는다.

## 구현과 보존한 조건

### 같은 실행에서 빌드한 JAR 재사용

```text
기존: 검사 잡에서 컴파일·테스트·bootJar → 이미지 잡에서 컴파일·bootJar 재실행
변경: 검사 잡에서 컴파일·테스트·bootJar → 산출물 업로드 → 검증 → 런타임 이미지 조립
```

`.github/actions/ci-jar`가 서비스별 아티팩트를 전달하고 `ci-jar.py`가 실행 JAR 하나만 선택한다.
서비스 이름·GitHub SHA·run ID·JAR SHA-256을 manifest에 기록하고 다운로드 후 대조한다.
불일치·누락·여러 실행 JAR는 실패한다. run attempt는 신뢰 조건으로 삼지 않아 이미지 잡만 재실행할 때도
같은 run과 revision의 이전 성공 산출물을 쓸 수 있다. 전체 재실행은 동일 이름의 산출물을 교체한다.

각 Dockerfile은 `JAR_SOURCE=builder`를 기본값으로 유지하고 CI만 `JAR_SOURCE=prebuilt`를 사용한다.
런타임 스테이지는 하나이므로 JRE, Business PDF 도구·폰트·비root 사용자, curl, Datadog agent,
포트·환경변수·ENTRYPOINT가 두 경로에서 동일하다. `ci-artifact/`는 gitignore되고 `build/` 제외 규칙과 분리된다.

Data의 `test` 잡은 `test bootJar`를 함께 실행하고 JAR 크기를 기존 산출물에서 잰다.
Checkstyle·SpotBugs·테스트가 성공해야 이미지 잡이 실행되는 의존 관계는 유지한다.
Data prod CI는 기존 source builder를 계속 쓴다. 이 작업은 prod CI의 검증·발행 흐름을 재설계하지 않는다.

### PR 입력별 전체 검사와 이미지 선택

| PR 변경 입력 | Business 전체 검사·이미지 | Notification 전체 검사·이미지 | 별도 계약 검사 |
| --- | --- | --- | --- |
| Data 소스·테스트만 | 생략 | 생략 | 유지 |
| Business 자체 입력 | 실행 | 생략 | 유지 |
| Notification 자체 입력 | 생략 | 실행 | 유지 |
| 양쪽 서비스 입력 | 실행 | 실행 | 유지 |
| 계약·아키텍처 문서만 | 생략 | 생략 | 유지 |
| 공통 CI/action/script·배포 설정·미분류 입력 | 실행 | 실행 | 유지 |

`git diff --no-renames --name-only -z base...head`로 PR merge-base부터 비교한다.
삭제와 다른 폴더로 이동한 원래 경로도 판정하며 API의 파일 개수 상한에 의존하지 않는다.
판정 실패·빈 변경 목록은 전체 검사로 처리한다.

Data/Noti 실제 Jackson 체크섬 검사는 Notification 실행 JAR를 필요로 한다.
Notification 전체 검사가 생략돼도 GitHub-hosted 러너에서 `bootJar`와 해당 probe는 계속 실행한다.
Python 격리/배포 계약, A22 계약, 공개 명령 원자성·동시성 검사는 줄이지 않는다.

기존 `business-api 검증`, `notification 검증`, `business-api 이미지`, `notification 이미지` 이름은 유지한다.
미선택 잡은 GitHub-hosted에서 생략 사유를 summary에 남긴다. 이 짧은 잡도 hosted 사용량에 포함된다.
공유 서버 슬롯을 잡지 않는 대신, Notification JAR probe의 hosted 실행 비용이 발생한다.

**main/release push는 최종 SHA의 두 이미지를 계속 모두 검증·발행한다.**
PR 파일 범위 판정으로 배포 입력이 사라지는 문제를 피한다. PR은 최종 이미지를 발행하지 않는다.

### 이미지 캐시

Business·Notification도 동일 리전 GAR의 registry cache를 사용한다.
서비스별 저장소와 `cache-amd64`/`cache-arm64` 태그로 나눠 `mode=max`로 저장한다.
캐시 인증은 GCE 메타데이터 토큰을 사용하며 최종 이미지 push 조건은 그대로다.
첫 실행은 새 캐시를 채우므로 warm cache 성과와 구분해야 한다.
캐시를 사용해도 런타임 이미지 구성 검사는 실행된다.

## 검증과 성과 기록 원칙

검증 결과는 [validation.md](validation.md)에 명령·환경·원본 로그 위치와 함께 기록한다.
변경 후 Actions 기록은 같은 수집기로 `actions-after.json`에 저장한다.

```bash
python3 .github/scripts/ci-timings.py \
  --output docs/engineering/ci-build-reuse/evidence/actions-after.json RUN_ID...
```

- 작업별 대기/실행, 서비스별 이미지 단계, 실패/생략 상태를 각각 비교한다.
- 소스 수정량·테스트 수·동시 PR 수·러너 부하·캐시 상태가 다르면 동일 조건 벤치마크로 표현하지 않는다.
- 구현상 제거한 작업 수와 실제 측정한 시간 개선을 분리한다.
- 로컬 arm64 호스트에서 `linux/amd64` 이미지를 만든 결과를 GCE 시간으로 환산하지 않는다.
- 실패·재시도도 기록한다. 성과 문서에는 성공 로그만 골라 인과관계를 과장하지 않는다.

## 자소서·면접에 활용할 설명

현재 근거로 쓸 수 있는 문장:

> 여러 서비스의 CI가 지연되는 문제를 작업별 타임스탬프로 분석했습니다.
> 이미지 작업이 실행에 4분 21초, 러너 대기에 46분 이상 걸리는 것을 확인하고,
> 공유 러너의 대기 문제와 중복 빌드 문제를 구분했습니다.
> 검증된 JAR를 동일 실행의 이미지에 재사용하고 서비스별 변경 입력과 외부 캐시를 적용해
> 불필요한 전체 검사와 이미지 생성을 줄이는 구조로 개선했습니다.
> 이 과정에서 계약 검사와 산출물 무결성 검증을 유지하고 재현 가능한 측정 기록을 남겼습니다.

시간 단축률은 변경 후 동등한 조건의 측정이 확보되기 전에는 넣지 않는다.
개인의 실제 역할(원인 분석·설계 판단·구현·검증 중 수행한 부분)에 맞게 문장을 조정한다.

## 참고 자료

- [GitHub workflow 산출물 전달](https://docs.github.com/en/actions/tutorials/store-and-share-data)
- [Docker GitHub Actions 캐시](https://docs.docker.com/build/ci/github-actions/cache/)
