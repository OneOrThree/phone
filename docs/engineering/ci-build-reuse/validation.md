# 검증 기록

## 결과

네 서비스 norm.sh와 계약 검사, 두 이미지 경로 모두 통과했다.

| 검사 | 테스트 수 | 실패/오류 | 생략 | 소요 시간 |
| --- | ---: | ---: | ---: | ---: |
| data-api norm.sh | 2631 | 0 | 8 | 300.3초 |
| business-api norm.sh | 760 | 0 | 0 | 133.9초 |
| notification norm.sh | 257 | 0 | 0 | 72.4초 |
| realtime norm.sh | 141 | 0 | 0 | 66.5초 |

- Python 전체 77건 통과(신규 CI 회귀 12건 포함).
- A22 producer 19종·template 92개 계약 통과.
- Data/Noti canonical records 5종의 실제 Jackson 체크섬 대조 통과.
- actionlint 1.7.12: 수정 workflow의 새 오류 없음. 기존 self-hosted 라벨을 등록하고 기존 비활성 pr-report의 `if: false` 경고만 제외. ShellCheck는 별도로 실행하지 않았다.
- 내부 리뷰: 규칙 축 0건, 요구사항 축 0건. 기준 커밋 `1313bce1c`.

## 실제 이미지 검증

| 서비스 | 경로 | 아키텍처 | 결과 | 소요 시간 |
| --- | --- | --- | --- | ---: |
| notification | prebuilt | linux/amd64 | 통과 | 3.8초 |
| notification | builder | linux/amd64 | 통과 | 117.5초 |
| business-api | prebuilt | linux/amd64 | 통과 | 2.4초 |
| business-api | builder | linux/amd64 | 통과 | 132.0초 |
| data-api | prebuilt | linux/amd64 | 통과 | 4.1초 |
| data-api | builder | linux/amd64 | 통과 | 119.7초 |
| realtime | prebuilt | linux/amd64 | 통과 | 2.8초 |
| realtime | builder | linux/amd64 | 통과 | 54.9초 |

`prebuilt` 네 이미지 모두 컨테이너 `/app/app.jar`의 SHA-256이 테스트 후 전달한 JAR와 일치했다.
해당 BuildKit 로그에 Gradle dependencies/bootJar RUN 단계가 없음을 확인했다.
`builder` 네 이미지는 기존 소스 빌드 경로의 호환성 검증이다.
Business·Notification은 linux/arm64 prebuilt 빌드와 컨테이너 JAR 해시 대조도 통과했다.
Business의 비root UID 10001, curl·pdftoppm·prlimit·Noto CJK 폰트와 Data Datadog agent 체크섬도 확인했다.

**위 시간은 기존 로컬 캐시가 섞인 검증 실행 시간이다.** 서로 다른 서비스 검사가 일부 동시에 실행됐고
builder의 의존성 다운로드 여부도 달라, 이 표로 단축률을 계산하지 않는다.

## 재현과 원본 로그

환경: macOS arm64, Docker Desktop VM 8 CPU / 약 8 GiB, Java 17.
명령·종료 코드·소요 시간·이미지 ID·JAR SHA-256·원본 로그 SHA-256은 [local-validation.json](evidence/local-validation.json)에 보관한다.
전체 로그는 작업 공간 `logs/ci-1800/`에 보관하고, 공유 문서에는 검증에 필요한 요약과 해시를 남긴다.

```bash
export JAVA_HOME="$(/usr/libexec/java_home -v 17)" # macOS; Linux는 설치된 Java 17 사용
export PATH="$JAVA_HOME/bin:$PATH"
python3 -m unittest discover -s .github/scripts -p "test_*.py" -v
for service in data-api business-api notification realtime; do
  bash "server/$service/norm.sh"
done
(cd server/data-api && ./gradlew bootJar --no-daemon)
python3 .github/scripts/check-satellite-contracts.py
python3 .github/scripts/check-migration-checksum.py
```

이미지 조립 입력 준비와 검증 예시:

```bash
revision=$(git rev-parse HEAD)
python3 .github/scripts/ci-jar.py pack --service notification --revision "$revision" --run-id local
python3 .github/scripts/ci-jar.py verify --service notification --revision "$revision" --run-id local
docker build --platform linux/amd64 --build-arg JAR_SOURCE=prebuilt -t noti:ci server/notification
docker run --rm --platform linux/amd64 --entrypoint sha256sum noti:ci /app/app.jar
# 기본 소스 빌드 경로
docker build --platform linux/amd64 -t noti:source server/notification
```

## 실패·검토 기록

- 최초 actionlint 실행은 저장소 전용 러너 라벨 미등록과 기존 `if: false` 경고로 nonzero였다.
  기존 설정을 반영해 재실행했으며 CI 검사 자체를 삭제하거나 비활성화하지 않았다.
- Git 변경 범위 판정 실패, 빈 diff, 실행/서비스/revision 불일치, JAR 변조·누락·복수 후보는 회귀 테스트로 확인했다.
- 이미지 단독 재실행은 같은 run/revision의 성공 아티팩트를 허용하도록 설계했다.
  실제 GitHub artifact 전달과 원격 소요 시간은 이 변경 PR 본문의 원격 검증 기록 및 Actions 탭에서 확인한다.

아직 GitHub에서의 단축률을 확정하지 않는다.
