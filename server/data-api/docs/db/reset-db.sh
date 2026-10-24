#!/usr/bin/env bash
# 기존 전체 삭제/Hibernate 재생성 스크립트는 Catus V0에서 폐기했다.
set -euo pipefail
printf '%s\n' '이 스크립트는 폐기되었습니다. DB를 변경하지 않았습니다.' >&2
printf '%s\n' 'dev/prod 검증·백업·보존 전환: python3 server/data-api/docs/db/rebase-v0.py --environment dev|prod' >&2
printf '%s\n' '접속 환경변수와 적용 절차: server/data-api/docs/db/README.md' >&2
exit 64
