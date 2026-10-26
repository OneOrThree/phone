# Android CI와 Play 내부 테스트 CD

CI 성공은 검사와 AAB 생성 성공을 뜻한다. Play 게시 결과는 별도의 Android CD 실행에서 확인한다. dev 서버용 `com.oneorthree.gromo` 앱을 대상으로 한다.

```text
PR → Android CI → 일회용 키 AAB 빌드 검사 (게시 없음)
main → 필수 앱 검사 → Android CI → AAB + CI 메타데이터
                                ↓ 성공 이벤트
                    Android CD: 원본 CI 검증 → 업로드 키 서명
                                → Play internal 게시·재조회
```

## CI와 버전

`app-android-ci.yml`은 빌드 설정과 AAB까지만 만든다. 빌드 잡에는 AWS·Play·업로드 서명 키를 전달하지 않는다. main의 SDK 공개 설정은 기존 격리된 설정 잡에서 읽으며 Play API를 조회하지 않는다. main 빌드의 PostHog 심볼 전송은 유지한다.

versionCode는 `max(ANDROID_VERSION_CODE_BASE, build.gradle의 versionCode) + GITHUB_RUN_NUMBER`로 정한다. 기준 변수가 비어 있으면 build.gradle 값을 사용한다. 같은 입력과 CI 실행의 재시도는 같은 코드를 사용하고, 다음 CI 실행은 더 큰 코드를 사용한다. CI와 CD가 겹쳐도 'Play 최대값+1'을 동시에 선택하는 경쟁이 없다.

기존 Play 버전이 이 값보다 높거나 workflow 실행 번호를 새로 시작했다면 저장소 변수 `ANDROID_VERSION_CODE_BASE`를 높인 뒤 새 CI를 실행한다. CD가 기존 Play 번호와 충돌하면 게시를 중단하며 임의로 AAB의 버전을 바꾸거나 재빌드하지 않는다. Android versionCode 상한은 코드에서 검증한다.

main CI 산출물 `android-ci-<run_id>-<run_attempt>`에는 `app-release.aab`와 `metadata.json`이 들어간다. 메타데이터는 소스 SHA·CI run ID·attempt·versionCode·AAB SHA-256을 연결한다. 14일 보관하며 만료된 경우 새 CI가 필요하다.

## 독립 CD와 신뢰 경계

`app-android-cd.yml`은 Android CI 완료 이벤트를 받고, 성공한 같은 저장소의 main push 또는 main 수동 CI만 선택한다. PR·fork·다른 workflow·실패 실행·현재 main 이력에 없는 SHA·재실행된 다른 attempt·누락/만료된 산출물은 거부한다. 산출물 이름과 checksum만 믿지 않고 GitHub API의 원본 실행 정보도 확인한다.

CD는 현재 main의 검증 코드만 checkout한다. 다운로드한 AAB나 메타데이터 안의 코드는 실행하지 않는다. 읽기 전용 source 잡에서 검증한 뒤 별도 sign 잡이 메타데이터를 다시 검증하고 업로드 키를 사용한다. 빌드 의존성 설치·Gradle 실행과 서명 키 사용은 별도 VM에 남는다.

Play 게시 잡은 `play-internal` 환경과 기존 OIDC 역할을 유지한다. 서명된 AAB checksum을 확인하고, 게시 전 Play 버전·AAB SHA-256과 게시 후 internal 트랙 상태·AAB SHA-256을 재조회한다. Play 실패가 이미 성공한 CI 실행의 결과를 바꾸지 않는다.

게시용 AAB 빌드와 검증용 AAB 빌드는 별도 job 대기열을 사용한다. Play 게시는 `android-play-internal` job 그룹으로 직렬화하며, 진행 중 실행은 유지하고 게시 대상 대기는 최신 하나만 남긴다. 검증 전용 CI·CD와 테스트 전용 push는 게시 대기를 대체하지 않는다.

## 수동 실행·재시도

Android CI 수동 실행은 빌드까지다. 성공한 main 실행은 자동 CD 대상이며, 다른 브랜치의 수동 CI는 게시하지 않는다. Android CD를 main에서 수동 실행할 때 `ci-run-id`에 성공한 main CI 실행 ID를 지정한다. CI의 현재 성공 attempt만 선택한다.

게시 후 PR 표시 등에서 실패했다면 CD의 실패한 게시 job만 재실행해 같은 서명 AAB를 재사용한다. 동일 versionCode의 기존 번들이 현재 업로드 바이트와 다르면 성공으로 간주하지 않는다. 서명까지 전체 재실행해 bytes가 바뀐 경우에는 새 CI를 실행하거나 게시 완료 상태를 별도 확인해야 한다.

`PLAY_INTERNAL_RELEASE_STATUS=draft`는 기존처럼 콘솔 출시 전 업로드 상태다. completed와 구분해 코멘트하고 배포 완료 라벨은 completed일 때만 붙인다.

## 코드와 검증

- `.github/ci/android-artifact.py` — 실행별 버전·AAB 메타데이터·checksum
- `.github/ci/android-cd-source.py` — 신뢰한 성공 CI·main 이력·attempt 산출물 확인
- `.github/ci/play-verify-bundle.py` — 버전 충돌과 게시 바이트 검증
- `.github/ci/test_android_pipeline.py` — 네트워크·실제 키 없이 경계 검사
- `.github/scripts/test_workflow_refactor.py` — 독립 실행·필수 검사·자격 증명 순서
- [Play Bundle API](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.bundles) — 게시 AAB의 versionCode·SHA-256

실제 Play 게시와 GitHub Actions 실행은 로컬 회귀 검사와 별도 검증이다.

### 자동 게시 입력

`app-change-plan.py`는 검증용 AAB 생성과 스토어 자동 게시 여부를 별도로 판정한다.
테스트·Markdown만 변경하면 AAB를 만들지 않고, workflow·CI helper 변경은 AAB를
검증하되 Play에는 자동 게시하지 않는다. 플랫폼별 네이티브 입력은 해당 플랫폼만,
공유 소스·asset·의존성·`ios/release-config.sh`는 두 플랫폼의 게시 입력이다.

Android CI 산출물의 schema 2 메타데이터에는 `publish`가 포함된다. CD는 checksum과
원본 실행을 검증한 뒤 이 값이 true인 경우에만 자동 서명·게시한다. CI를 수동 실행한
경우에도 자동 게시하지 않으며, 실제 게시 시험은 성공한 main CI 실행 ID로 Android CD를
명시적으로 수동 실행한다. schema 1의 과거 산출물은 새 CI 실행으로 다시 생성해야 한다.
