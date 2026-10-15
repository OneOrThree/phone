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
