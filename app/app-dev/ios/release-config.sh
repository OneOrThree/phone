#!/usr/bin/env bash
# 2.0(Catus) iOS 릴리스 빌드의 공개 설정 — testflight.sh 가 읽는다. 비밀값은 여기에 두지 않는다.
# (비밀값인 App Store Connect API 키는 fastlane/.env 또는 환경변수 — fastlane/.env.example 참고)
#
# 환경변수로 이미 들어온 값이 있으면 그걸 우선한다(긴급 덮어쓰기용). 평소엔 이 파일이 정본이다.

# 앱이 사용자에게 보여 주는 약관 문서의 판. 로그인 요청의 termsVersion 으로 서버에 기록된다.
# 비어 있으면 로그인이 막히므로 운영·dev 빌드 모두 필수. 약관 문서를 실제로 개정할 때만 바꾼다.
export EXPO_PUBLIC_TERMS_VERSION="${EXPO_PUBLIC_TERMS_VERSION:-2026-09}"

# cattus 전용 Datadog RUM 공개 설정 — gromo 1.x와 수집 공간을 분리한다.
# Client Token은 앱에 포함되는 공개값이며 Datadog API/App Key와 다르다.
export EXPO_PUBLIC_DATADOG_APPLICATION_ID="${EXPO_PUBLIC_DATADOG_APPLICATION_ID:-31edaff8-b8b4-434b-9d8c-898e05a41255}"
export EXPO_PUBLIC_DATADOG_CLIENT_TOKEN="${EXPO_PUBLIC_DATADOG_CLIENT_TOKEN:-pub087cf0808d661352a6195ccbe2352205}"
# 셸에 남은 옛 덮어쓰기 설정으로 gromo에 다시 보내지 않게 한다.
if [ "$EXPO_PUBLIC_DATADOG_APPLICATION_ID" = "44a4f021-ed4d-4134-b59d-63a40e37c2ff" ]; then
  echo "cattus 빌드에는 gromo 1.x의 Datadog Application ID를 사용할 수 없습니다." >&2
  return 1 2>/dev/null || exit 1
fi

# 집중 시작의 자리 좌표 — 비우면 실제 API 주소로 판정(운영 생략, dev 전송)한다.
# 운영 Business·Data와 seat_x/seat_y DB 배포를 확인한 뒤 기본값을 1로 바꾼다.
# OTA도 이 파일을 읽으므로 셸의 EXPO_PUBLIC_* 값만으로 운영 기능을 켜지 않는다.
export EXPO_PUBLIC_FOCUS_SEAT_ENABLED="${EXPO_PUBLIC_FOCUS_SEAT_ENABLED:-}"

# GROMO-2523 Firebase 프로젝트 ID — 각 환경 알림 서버의 FCM_PROJECT_ID(공개값). 빌드 단계
# scripts/firebase-plist-xcode.sh 가 GoogleService-Info.plist 의 PROJECT_ID 와 대조한다.
# dev 는 dev 알림 서버(phone-notification-1)의 값을 2026-10-26 에 확인했다.
# prod 는 dev 와 나눈 운영 전용 프로젝트 catus-prod(2026-10-27) — 운영 알림 서버의 FCM_PROJECT_ID·서비스
# 계정도 이 프로젝트여야 운영 앱이 받는다(dev 자격으로 운영 사용자에게 보내지 못하게 나눴다).
export GROMO_FIREBASE_PROJECT_ID_DEV="${GROMO_FIREBASE_PROJECT_ID_DEV:-catus-dev}"
export GROMO_FIREBASE_PROJECT_ID_PROD="${GROMO_FIREBASE_PROJECT_ID_PROD:-catus-prod}"
