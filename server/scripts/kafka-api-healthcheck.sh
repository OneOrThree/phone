#!/usr/bin/env bash
set -euo pipefail

# Kafka ApiVersions v0 요청: 길이 10, API 키 18, 버전 0, correlation ID 1, client ID 없음.
exec 3<>/dev/tcp/127.0.0.1/9092
printf '\x00\x00\x00\x0a\x00\x12\x00\x00\x00\x00\x00\x01\xff\xff' >&3

# 응답 길이, correlation ID, 오류 코드를 읽어 요청 성공을 확인한다.
reply=$(dd bs=10 count=1 iflag=fullblock <&3 2>/dev/null | od -An -tx1 -v | tr -d ' \n')
test "${#reply}" -eq 20
test "${reply:8:8}" = 00000001
test "${reply:16:4}" = 0000
