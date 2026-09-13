# 검증 기록

## 환경과 원본 로그

- 로컬: macOS arm64, Docker Desktop VM 8 CPU / 약 8 GiB, Java 17.
- 코드 기준: `ebdaa4074dbee938b2ce76801a9f5f76cdafdff6`에 CI 변경을 적용.
- 전체 명령 로그: 이 작업 공간의 `logs/ci-1800/` (gitignored, 로컬 보관).
- 실행 명령·종료 코드·소요 시간: `logs/ci-1800/validation.json`.
- 공유 기록에는 요약·로그 SHA-256·테스트 수를 남기며 원본 로그의 절대 경로나 비밀 값을 게시하지 않는다.

## 진행 기록

1. JAR 무결성·실행 식별·삭제/이동 파일 판정 회귀 테스트 10건 통과.
2. actionlint 1.7.12로 수정 workflow 검사. 기존 self-hosted 라벨 `ci`, `spot`을 별도 설정으로 등록하고,
   변경 전부터 비활성화된 `pr-report: if: false` 경고만 제외했다. 새 workflow 문법 오류 없음.
3. 네 서비스의 norm.sh, Python 전체 검사, A22 계약, 실제 Data/Noti 체크섬 검사를 실행 중이다.
4. 실제 이미지 조립·전달 JAR 동일성·기본 source build 호환성은 위 검사가 끝난 뒤 기록한다.

아직 변경 후 GitHub 실행 시간이나 단축률이 측정됐다고 주장하지 않는다.
