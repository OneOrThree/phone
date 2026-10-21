#!/usr/bin/env bash
# 2.0(Catus) iOS 릴리스 빌드의 공개 설정 — testflight.sh 가 읽는다. 비밀값은 여기에 두지 않는다.
# (비밀값인 App Store Connect API 키는 fastlane/.env 또는 환경변수 — fastlane/.env.example 참고)
#
# 환경변수로 이미 들어온 값이 있으면 그걸 우선한다(긴급 덮어쓰기용). 평소엔 이 파일이 정본이다.

# 앱이 사용자에게 보여 주는 약관 문서의 판. 로그인 요청의 termsVersion 으로 서버에 기록된다.
# 비어 있으면 로그인이 막히므로 운영·dev 빌드 모두 필수. 약관 문서를 실제로 개정할 때만 바꾼다.
export EXPO_PUBLIC_TERMS_VERSION="${EXPO_PUBLIC_TERMS_VERSION:-2026-09}"

# Datadog RUM 공개 설정 — 1.x 와 같은 RUM application 을 쓴다. 클라이언트 토큰은 앱 안에 들어가는 공개값이다.
export EXPO_PUBLIC_DATADOG_APPLICATION_ID="${EXPO_PUBLIC_DATADOG_APPLICATION_ID:-44a4f021-ed4d-4134-b59d-63a40e37c2ff}"
export EXPO_PUBLIC_DATADOG_CLIENT_TOKEN="${EXPO_PUBLIC_DATADOG_CLIENT_TOKEN:-pub851a727c3f95bc795ae8f9a15f5326d4}"

# 홈 섬 기능 스위치(GROMO-2400) — 운영 빌드·dev TestFlight·안드로이드 CI·운영 OTA 가 모두 켠 채 나간다.
# 타일 섬 지형(GROMO-2230): 홈 섬 바닥을 타일 Atlas 로 그리고 탭 이동을 nav A* 로 한다. 웹은 무시.
export EXPO_PUBLIC_TILE_ISLAND="${EXPO_PUBLIC_TILE_ISLAND:-1}"
# 홈 섬 이동 동기화(GROMO-2248): 타일 섬과 함께 켜져야 동작한다. 서버가 없거나 거절하면 로컬 걷기로 돌아간다.
export EXPO_PUBLIC_MOVEMENT_SYNC="${EXPO_PUBLIC_MOVEMENT_SYNC:-1}"
