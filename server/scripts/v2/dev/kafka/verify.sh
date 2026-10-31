#!/usr/bin/env bash
# 독립 점검 토픽에서 브로커의 생산·소비를 확인한다.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
"$root/common/verify-data-mount.sh" data
container=catus-dev-kafka-v2-kafka-1
topic=catus-dev-v2-probe
cli=(docker exec -e KAFKA_HEAP_OPTS=-Xmx128m "$container")
"${cli[@]}" /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic "$topic" --partitions 1 --replication-factor 1 --config retention.ms=3600000 >/dev/null
last=$("${cli[@]}" /opt/kafka/bin/kafka-get-offsets.sh --bootstrap-server kafka:9092 --topic "$topic" --time -1)
offset=${last##*:}
[[ "$offset" =~ ^[0-9]+$ ]] || { echo 'Kafka offset 조회 실패' >&2; exit 1; }
message="dev-v2-$(cat /proc/sys/kernel/random/uuid)"
printf '%s\n' "$message" | docker exec -i -e KAFKA_HEAP_OPTS=-Xmx128m "$container" /opt/kafka/bin/kafka-console-producer.sh --bootstrap-server kafka:9092 --topic "$topic" >/dev/null
result=$("${cli[@]}" /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server kafka:9092 --topic "$topic" --partition 0 --offset "$offset" --max-messages 1 --timeout-ms 30000 2>/dev/null)
[[ "$result" = "$message" ]] || { echo 'Kafka 생산·소비 검증 실패' >&2; exit 1; }
echo 'Kafka 생산·소비 확인 완료'
