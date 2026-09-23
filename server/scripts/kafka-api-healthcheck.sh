#!/usr/bin/env bash
set -euo pipefail

# Kafka ApiVersions v0 요청: 길이 10, API 키 18, 버전 0, correlation ID 1, client ID 없음.
exec 3<>/dev/tcp/127.0.0.1/9092
printf '\x00\x00\x00\x0a\x00\x12\x00\x00\x00\x00\x00\x01\xff\xff' >&3

# 포트 개방만으로 성공 처리하지 않고 브로커 응답의 길이 필드를 읽는다.
reply_bytes=$(dd bs=4 count=1 iflag=fullblock <&3 2>/dev/null | wc -c)
test "$reply_bytes" -eq 4
