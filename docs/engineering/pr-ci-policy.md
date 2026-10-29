# PR 대상에 따른 서버 CI 정책

피처 브랜치에 하위 PR을 쌓을 때 Data API 같은 전체 기능·통합 테스트를 매번 반복하지 않는다.
통합 검증은 main 대상 PR에서 수행한다. 자동 코드 리뷰와 가벼운 마이그레이션 불변 검사는 별도로 유지한다.

| 경로 | 자동 검사·발행 |
| --- | --- |
| 피처 → 피처 | 서버 전체 기능 CI 생략. 필요할 때 해당 브랜치에서 수동 검사 |
| 피처 → main | 변경 서비스의 빌드·기능 테스트·계약 검사 필수 |
| 같은 저장소 main → release | 승격 출처·버전 라벨·산출물 계획 검증. 전체 Gradle 기능 테스트와 이미지 재빌드는 PR에서 생략 |
| main 병합 후 | 최종 main SHA 검사·JAR 생성 후 dev 이미지 발행·CD |
| release 병합 후 | 최종 release SHA의 운영 빌드·산출물 검증·발행. 운영 적용은 별도 CD |

main → release는 **Create a merge commit**으로 main 부모 이력을 보존한다.
`release:major`, `release:minor`, `release:patch`는 최대 하나를 붙이며 없으면 patch다.
포크 저장소의 main 또는 선별 이식 브랜치 → release는 main 승격으로 간주하지 않고 기존 기능 검증을 유지한다.
승격 PR에서 기능 테스트를 생략해도 release push에서 운영 JAR·이미지를 만들고 검증하는 절차는 유지한다.
백오피스의 기존 독립 태그 발행 경로와 운영 CD 승인·인증은 이 정책에서 변경하지 않는다.

## 피처 브랜치에서 수동으로 기능 검사하기

```sh
gh workflow run data-api-ci.dev.yml --ref feat/작업-브랜치
gh workflow run realtime-ci.dev.yml --ref feat/작업-브랜치
gh workflow run satellite-ci.dev.yml --ref feat/작업-브랜치
gh workflow run backoffice-ci.yml --ref feat/작업-브랜치
```

GitHub Actions의 **Run workflow**에서 브랜치를 선택해도 된다. 정책을 적용한 workflow가 해당 브랜치에도 있어야 한다.
수동 실행은 GitHub-hosted에서 기능·계약 검사를 수행하며 dev 이미지 빌드는 생략한다. dev AWS 자격 조회·GAR 발행·dev CD는 `push`와 `main` 조건을 유지하므로 수동 검사로 배포되지 않는다.
위성 서비스 수동 검사는 두 서비스를 모두 검사한다. 자동 main PR에서는 기존 변경 서비스 판정을 따른다.

피처 간 검사를 생략하면 통합 문제 발견이 main 대상 PR까지 늦어질 수 있다. 긴 작업 중에는 위 수동 검사를 실행하고 main PR의 필수 검사가 끝나기 전에 병합하지 않는다.

## 구현 위치

- `.github/scripts/pr-ci-policy.py`: 같은 저장소 main 승격과 전체 검사 대상 판정
- `.github/workflows/pr-ci-policy.yml`: 가벼운 정책·브랜치 경계 회귀 검사
- Data·Realtime·Satellite·Backoffice dev CI: main 대상 필터와 수동 검사
- `prod-ci.yml`, `prod-ci-V2.yml`: 승격 PR의 전체 Gradle·이미지 검사 생략
- `backoffice-ci.prod-V2.yml`: 승격 PR의 중복 npm 기능 검사 생략
