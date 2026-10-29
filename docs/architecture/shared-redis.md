# Business·Data·Realtime 공유 Redis

티켓 2589. 이 문서는 구현과 적용 절차를 설명한다. 문서 작성·로컬 검증은 운영 적용 완료를 뜻하지 않는다.

## 저장 정책

Redis 7.4.11 한 개를 사용한다. 데이터 한도는 384MiB, 컨테이너 한도는 576MiB다.
기존 두 Redis의 데이터 예산 합계를 우선 유지한다. 컨테이너 하나가 줄어도 저장할 데이터의 메모리는 필요하다.
`noeviction`, `appendonly yes`, `appendfsync everysec`와 기존 공유 Redis 볼륨을 유지한다.
OOM 시 추가 쓰기는 실패한다. AOF와 볼륨은 HA나 무손실 보장이 아니다.

| 소유자 | 키·채널 | 정책 |
| --- | --- | --- |
| Business | `cache:business:preview:slot:v1:{0..63}` | 전체 64개 슬롯, 직렬화 항목당 1MiB |
| Business | `cache:business:revoked-session:*`, `withdrawn:*`, `rate:*` (모두 `cache:business:` 아래) | 기존 TTL 유지, 미리보기 축출 대상 제외 |
| Data | `presence:*` | 쓰기 소유자 |
| Realtime | `cache:chat:*`, `lock:chat:*`, 등록된 movement·sea 키, `chat:*` 채널 | 소유 키 읽기·쓰기, presence는 별도 읽기 전용 selector |

미리보기에는 사용자와 URL 해시를 함께 저장하고 둘을 대조해 조회한다. 같은 URL이라도 다른 사용자의
항목은 읽지 않는다. 슬롯 검색은 64개 작은 메타데이터로 제한하며 큰 payload는 일치한 슬롯에서만 읽는다.
선점·완료·조회 순서 갱신·탈퇴 삭제는 Lua로 원자 처리한다. 모든 키는 KEYS 인자로 명시한다.

PENDING은 90초, READY는 300초, FAILED는 30초다. 여유 슬롯이 없으면 최근 조회가 가장 오래된
완료 항목만 교체한다. 모두 처리 중이면 새 요청을 `FAILED/BUSY`로 반환하고 worker를 시작하지 않는다.
늦은 worker는 사용자·URL·세대가 같은 PENDING에만 결과를 쓸 수 있다.
payload 64MiB 외에 Redis 해시·키·할당자·AOF 버퍼 메모리가 추가된다.
이 한도는 서비스별 CPU·지연·장애 격리를 제공하지 않는다.

## 전환 중 차단 정보 보존

이전 Business Redis는 영속화가 없고 business ACL에 PTTL도 없다. ACL을 바꾸려고 재생성하거나
현재 키를 무조건 비우면 세션 거부목록이 사라진다. 따라서 기존 컨테이너를 그대로 유지하는 bridge를 사용한다.

1. 새 Business의 기본 연결은 공유 Redis다. 전환 기간에만 다음 Business 전용 설정을 추가한다.
   `BUSINESS_REDIS_LEGACY_HOST=business-redis`, `BUSINESS_REDIS_LEGACY_PORT=6379`,
   `BUSINESS_REDIS_LEGACY_USERNAME=business`, `BUSINESS_REDIS_LEGACY_PASSWORD=<이전 비밀번호>`.
2. 세션·탈퇴 차단 조회는 새 저장소를 먼저 읽고, 없으면 기존 저장소를 읽는다. 기존 키의 TTL을 갱신하지 않는다.
3. 새 차단 표지는 양쪽에 동일한 절대 만료 시각(`SET PXAT`)으로 기록한다. 일부 쓰기 실패는 성공으로 숨기지 않는다.
   미리보기·요청 제한 카운터는 공유 Redis에만 새로 만든다. 전환 시 이전 요청 제한 창은 이어받지 않는다.
4. 이전 이미지를 실행하는 Business가 모두 교체된 뒤, 기존 차단 표지의 최대 수명을 기다린다.
   최소 2시간이며, 이전/현재 AT 차단 TTL+60초가 더 길면 그 값을 적용한다. 검사 도구는 추가 60초 여유를 둔다.
   이 기간 새 차단 표지는 이미 공유 Redis에도 있으므로, 기존 저장소에만 존재하던 표지는 자연 만료된다.
5. 탈퇴 시 새 슬롯뿐 아니라 기존 Redis에 남은 해당 사용자의 이전 형식 미리보기와 레이트 키도 삭제한다.

소스 Redis가 전환 중 죽거나 키를 자체 축출하면 기존 보존 한계는 남는다.
Redis 조회 장애의 인증 fail-open도 이번 변경에서 바꾸지 않았다.
bridge 중 재시작·배포를 했다면 검사 도구는 현재 Business 컨테이너 시작부터 보수적으로 다시 기다린다.

## dev 최초 적용

일반 CD는 Redis를 재생성하지 않는다. `dev-env.sh`는 실행 중인 Redis의 ACL 해시·실행 정책·health와
기존 Business Redis 존재 여부를 검사하고, 미전환 환경이면 앱 배포 전에 중단한다.

1. 같은 구성의 Business·Data·Realtime 이미지를 준비한다. Business 이미지의
   `com.oneorthree.redis-layout=shared-v1` 라벨을 검사한다. 과거 Business 이미지는 이 구성에 배포하지 않는다.
2. 기존 `BUSINESS_REDIS_PASSWORD`를 보존하고 서로 다른 `REDIS_DATA_PASSWORD`,
   `REDIS_REALTIME_PASSWORD`를 준비한다. 기존 컨테이너가 있으면 위 bridge 자격도 설정한다.
   같은 작업에서 Redis 비밀번호를 회전하지 않는다.
3. 기존 `dev-env.sh`는 전환 전 관문에서 막히므로 최초 준비는 writer를 직접 호출한다.
   합성 테스트와 달리 실제 SecretString은 표준입력으로만 공급하며, 전체 compose/env를 로그에 출력하지 않는다.
   `write-compose-env.py --output <out>/dev.env --app-image <Data digest> --shared-redis-acl-output <out>/shared-redis.acl`로
   파일을 만들고, `prepare-satellite-deploy.py`에 같은 JSON·dev.env·각 이미지 digest와
   `--data-image`를 전달해 전용 env를 만든다. Realtime 이미지도 Compose 보간에 지정한다.
4. Data·Realtime·Business의 신규 요청을 중단하고 해당 앱을 멈춘다. 기존 Business Redis는 멈추지 않는다.
   ACL 없는 기존 dev 공유 Redis에 AOF가 꺼져 있다면 **재시작 전에** 기존 연결로
   `CONFIG SET appendonly yes`를 적용한다. `INFO persistence`에서
   `aof_enabled:1`, `aof_rewrite_in_progress:0`, `aof_last_bgrewrite_status:ok`를 확인한다.
   기존 상태를 보존하지 않은 채 AOF 설정만 바꿔 재생성하지 않는다.
5. ACL 파일을 `/var/lib/gromo/runtime/shared-redis.acl`에 설치한다. 부모는 0700, 파일은 0644다.
   Compose의 `SHARED_REDIS_ACL_FILE`을 이 경로로, `SHARED_REDIS_ACL_SHA`를 파일 SHA-256으로 지정한다.
   기존 `redis_dev_data` 볼륨을 유지하고 `up -d --no-deps --force-recreate redis`만 수행한다.
6. 같은 준비 파일과 dev·realtime·satellites·satellites.dev·satellites.data.dev 조합으로
   Data·Realtime·Business를 `--no-deps`로 기동한다. readiness와 로그인·집중·채팅·미리보기의
   정상 흐름을 확인하고 요청을 재개한다. 전환 중 `down -v`, `--remove-orphans`, 기존 Business Redis 재생성을 사용하지 않는다.
7. 이후 일반 CD는 준비된 공유 Redis를 검사하고 앱만 교체한다.

## prod 최초 적용

실행 구성은 Infra 저장소의 `prod/catus/runtime/`에 있다. phone과 Infra 변경을 함께 검토한다.
새 Infra SHA 구성과 위 Business 이미지를 포함한 릴리스를 준비하고, 기존 승인 절차의
`bootstrap`으로 공유 Redis ACL·용량 설정을 적용한다. 기존 볼륨 `presence-data`는 그대로 쓴다.
공유 Redis는 기존부터 AOF를 사용하지만 적용 전 실제 설정·볼륨을 확인한다.

기존 Business Redis는 새 Compose의 실행 대상에서 제거했으므로 기존 컨테이너가 그대로 남는다.
배포 엔진은 이 컨테이너가 있는데 bridge 설정이 없으면 거부한다. bootstrap의 재생성 대상에도
기존 Business Redis를 포함하지 않는다. Business는 전환 연결을 위해 기존 `business-cache` 네트워크를 유지한다.

최초 bootstrap은 공유 Redis 재시작으로 Data·Realtime에도 영향을 준다. 유지보수 시간에 적용하고
세 앱의 readiness를 확인한다. 일반 릴리스는 Redis ACL이 달라지면 기존처럼 bootstrap을 요구한다.
Infra 구성 변경 전용 릴리스에 과거 Business 이미지가 재사용되면 라벨 검사에서 거부한다.

## 기존 Redis 제거와 복구

Business 인스턴스가 하나인 현재 구성 전용 절차다. 이전 배포를 포함한 최대 표지 TTL을 확인한 뒤 실행한다.

```bash
python3 server/scripts/check-redis-retirement.py --project catus --max-marker-ttl-seconds 7200
# dev는 --project phone. 7200보다 긴 표지 TTL을 사용했다면 실제 최댓값을 지정한다.
```

이 명령은 검사만 한다. 통과 후 다음 순서로 제거한다.

1. Business 신규 요청을 중단하고 Business 컨테이너를 멈춘다.
2. 해당 프로젝트의 기존 `business-redis` 컨테이너만 제거한다. 공유 Redis와 볼륨은 유지한다.
3. `BUSINESS_REDIS_LEGACY_*` 설정을 제거하고 같은 검증된 Business 이미지를 재기동한다.
4. 준비성과 정상 흐름을 확인한 뒤 요청을 재개한다.

전환 기간에는 새 차단 표지를 양쪽에 쓰므로 이전 Redis에만 있는 표지를 기다리는 동안 보존한다.
기존 Redis를 제거한 후에는 **공유 Redis를 지원하는 이미지와 구성으로만** 복구한다.
이전 전용 Redis 구성이나 이를 다시 생성하는 과거 릴리스로 되돌리면 최근 차단 표지가 빠진다.
실패 시 데이터를 비우지 말고 공유 Redis 볼륨·ACL·기존 컨테이너를 보존한 채 실패한 단계부터 복구한다.

## HA 판단과 관측

이번에는 단일 Redis를 유지한다. 서버 장애와 Redis 프로세스 장애 시 수동 복구까지 중단을 감수한다.
동일 서버에 복제본을 추가해도 서버 장애를 견디지는 못한다. 자동 장애 전환이 필요하거나,
허용 중단 시간 안에 수동 복구하기 어려워지면 독립 장애 영역의 관리형 HA 또는 Sentinel 구성을 검토한다.
Sentinel의 견고한 구성은 서로 독립적으로 고장 나는 위치의 Sentinel 3개 이상을 전제로 한다.
[Redis Sentinel 문서](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)

공유 Redis의 health 계정으로 Datadog/Redis exporter가 INFO·설정·slowlog를 조회한다.
메모리 사용률, OOM 쓰기 오류, evicted_keys, AOF 쓰기·rewrite 오류, 재시작과 지연을 확인한다.
미리보기 슬롯 포화는 `preview_rejected reason=CACHE_FULL` 로그로 구분한다.
경보 수신 여부와 실제 복구 시간은 운영에서 별도 확인해야 한다.

검증은 외부 서비스와 격리된 로컬 Redis와 합성 자격으로 수행한다. AWS 부하 테스트 및 부하용 데이터 생성은 금지한다.
