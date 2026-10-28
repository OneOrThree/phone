#!/bin/sh
set -eu

# Expo/RN과 같은 Node 경로를 사용하며 토큰을 명령 인자나 로그로 출력하지 않는다.
if [ -f "$SRCROOT/.xcode.env" ]; then . "$SRCROOT/.xcode.env"; fi
if [ -f "$SRCROOT/.xcode.env.local" ]; then . "$SRCROOT/.xcode.env.local"; fi
NODE_BINARY=${NODE_BINARY:-$(command -v node)}
"$NODE_BINARY" "$SRCROOT/../scripts/airbridge-ios-build-config.cjs" \
  "$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/AirbridgeConfig.json"
