#!/bin/sh
# GROMO-2523 Xcode 빌드 단계 「[Firebase] Copy GoogleService-Info.plist」 — 서버 환경에 맞는 plist 를 앱 번들에 넣는다.
# plist 는 커밋하지 않는다. 원본: ${GROMO_IOS_CREDENTIALS_DIR:-ios/credentials}/<dev|prod>/GoogleService-Info.plist
# 1.x GROMO-1234 교훈: Debug/Release 가 아니라 서버 환경(EXPO_PUBLIC_ENV)으로 고른다 — dev 서버 + prod 파베면 SENDER_ID_MISMATCH.
# 단독 실행: SRCROOT·TARGET_BUILD_DIR·UNLOCALIZED_RESOURCES_FOLDER_PATH·PRODUCT_BUNDLE_IDENTIFIER·CONFIGURATION 을 환경으로 준다.
set -u
[ -f "$SRCROOT/.xcode.env" ] && . "$SRCROOT/.xcode.env"
[ -f "$SRCROOT/.xcode.env.local" ] && . "$SRCROOT/.xcode.env.local"
. "$SRCROOT/release-config.sh"

ENV_NAME="${EXPO_PUBLIC_ENV:-dev}"
case "$ENV_NAME" in
  dev) KEY=GROMO_FIREBASE_PROJECT_ID_DEV; EXPECTED="${GROMO_FIREBASE_PROJECT_ID_DEV:-}" ;;
  prod) KEY=GROMO_FIREBASE_PROJECT_ID_PROD; EXPECTED="${GROMO_FIREBASE_PROJECT_ID_PROD:-}" ;;
  *) echo "error: EXPO_PUBLIC_ENV=$ENV_NAME — dev 또는 prod 만 허용한다" >&2; exit 1 ;;
esac
SRC="${GROMO_IOS_CREDENTIALS_DIR:-$SRCROOT/credentials}/$ENV_NAME/GoogleService-Info.plist"
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/GoogleService-Info.plist"

rm -f "$DEST" # 증분 빌드에 다른 환경의 plist 가 남지 않게 먼저 지운다
if [ ! -f "$SRC" ]; then
  if [ "${CONFIGURATION:-}" = Release ]; then
    echo "error: iOS release 차단: $SRC 없음 — 푸시를 못 받는 바이너리가 나간다" >&2
    exit 1
  fi
  echo "warning: $SRC 없음 — 이 빌드는 푸시를 등록하지 않는다(FCMTokenModule 이 NOT_CONFIGURED)"
  exit 0
fi
if [ "$(/usr/libexec/PlistBuddy -c 'Print :BUNDLE_ID' "$SRC" 2>/dev/null)" != "$PRODUCT_BUNDLE_IDENTIFIER" ]; then
  echo "error: $SRC 의 BUNDLE_ID 가 $PRODUCT_BUNDLE_IDENTIFIER 가 아니다" >&2
  exit 1
fi
if [ -z "$EXPECTED" ]; then
  echo "error: ios/release-config.sh 의 $KEY 가 비어 있어 plist 를 검증할 수 없다 — $ENV_NAME 서버의 FCM_PROJECT_ID 를 채운다" >&2
  exit 1
fi
if [ "$(/usr/libexec/PlistBuddy -c 'Print :PROJECT_ID' "$SRC" 2>/dev/null)" != "$EXPECTED" ]; then
  echo "error: $SRC 의 PROJECT_ID 가 $ENV_NAME 서버 FCM_PROJECT_ID($EXPECTED)와 다르다 — 발송이 SENDER_ID_MISMATCH 로 실패한다" >&2
  exit 1
fi
cp "$SRC" "$DEST" && echo "GoogleService-Info.plist($ENV_NAME, $EXPECTED) 를 앱 번들에 넣었다"
