#!/usr/bin/env bash
# dev V2 전용 Kafka의 알림 및 선택적 Realtime 이벤트 토픽을 준비한다.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
"$root/common/verify-data-mount.sh" data
exec 9>/run/lock/catus-dev-v2-data.lock
flock -n 9 || { echo '같은 호스트의 배포가 진행 중입니다.' >&2; exit 1; }
container=catus-dev-kafka-v2-kafka-1
[[ $(docker inspect --format '{{.State.Health.Status}}' "$container") = healthy ]] || { echo 'dev V2 Kafka가 healthy가 아닙니다.' >&2; exit 1; }
for topic in notification-events notification-events.DLT realtime-events realtime-events.DLT; do
  docker exec -e KAFKA_HEAP_OPTS='-Xmx128m -Xms64m' "$container" /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --create --if-not-exists --topic "$topic" --partitions 3 --replication-factor 1
  info=$(docker exec -e KAFKA_HEAP_OPTS='-Xmx128m -Xms64m' "$container" /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --describe --topic "$topic")
  grep -Eq 'PartitionCount:[[:space:]]*3([[:space:]]|$)' <<< "$info" || { echo "$topic 파티션이 3개가 아닙니다." >&2; exit 1; }
  grep -Eq 'ReplicationFactor:[[:space:]]*1([[:space:]]|$)' <<< "$info" || { echo "$topic 복제 계수가 1이 아닙니다." >&2; exit 1; }
  printf '%s 준비 완료\n' "$topic"
done
