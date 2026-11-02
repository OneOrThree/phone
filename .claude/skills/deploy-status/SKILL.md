---
name: deploy-status
description: PR 이나 커밋이 dev·운영 어디까지 배포됐는지 물을 때 쓴다. where_is.py 가 deployment-status 기록과 비교해 단위별로 답한다.
---

# deploy-status — 이 변경은 어디까지 갔나

경로별 흐름의 정본은 [파이프라인 지도](../../../docs/engineering/pipeline-map.md)다. 이 스킬은 배포 기록을 읽어 답하는 방법만 담는다.

## 1. 스크립트로 본다

```sh
python3 .claude/skills/deploy-status/scripts/where_is.py <PR번호|SHA>
```

단위 8개(dev data-api·realtime·business-api·notification, 운영 서버, 백오피스, Kafka, Redis)마다 한 줄을 낸다. 머지되지 않은 PR 은 머리 줄과 닿는 단위만 낸다. 조회만 한다. 완료 조건: exit 0 이고, 머지된 변경이면 단위 8줄이 다 나왔다. 「확인 못 함」이나 「닿음 판정 못 함」 줄이 있으면 exit 1 이다. 그 단위는 4절로 더 본다.

| 판정 | 뜻 |
| --- | --- |
| 반영됨 | 이 변경이 그 단위의 빌드 입력이고, 기록된 배포 커밋에 들어 있다 |
| 아직 안 감 | 빌드 입력인데 기록된 배포 커밋에 없다. 2절의 다음 단계가 남았다 |
| 해당 없음 | 그 단위의 빌드 입력이 아니다. 뒤의 「포함」은 기록 커밋에 들어 있다는 뜻일 뿐이다 |
| 확인 못 함 | 기록이나 비교를 읽지 못했다. 이유가 같은 줄에 있다 |

- 빌드 입력(닿음) 판정: dev 4종은 `.github/scripts/v2/dev/dev-fingerprint-V2.py` 의 입력 목록, 운영 서버는 `.claude/prod-impact.py` 의 `build_inputs`(운영 지문 조건)를 쓴다. 백오피스·Kafka·Redis 는 prod-impact 규칙 3·4 와 같은 경로 조건이다.
- 포함 판정: GitHub compare `<커밋>...<기록 커밋>` 의 status 가 `ahead`·`identical` 이다.
- 기록: `deployment-status` 브랜치의 `state.json`(dev, 성공 기록만 믿는다)과 `prod-V2/<역할>.json`(마지막 성공 태그). 운영 단위 줄 끝에는 그 CD 워크플로의 최근 실행이 붙는다.
- PR 은 머지 커밋으로 본다. SHA 를 주면 그 커밋의 변경 파일로 닿음을 본다.

## 2. 아직 안 갔으면

| 단위 | 다음 단계 |
| --- | --- |
| dev 4종 | main 머지 뒤 `Auto CD (dev)-v2` 가 배포한다. 머지했는데 안 갔으면 4절로 본다 |
| 운영 서버·Kafka·Redis | main 머지만으로는 가지 않는다. 사람이 release 승격과 운영 CD 를 돌린다(`/prod-release`) |
| 백오피스 | `.md` 가 아닌 파일의 main 머지가 운영 배포를 시작한다. `backoffice-production` 승인 1회가 남아 있을 수 있다 |
| 앱 | 이 표에 없다. 스토어·OTA 로만 사용자에게 간다. Android 는 main 머지 → Play internal 자동 게시다(`/app-release`) |

## 3. 함정

- `Auto CD (dev)-v2` 실행이 success 여도 `app` 잡은 skipped 일 수 있다. dev 반영은 실행 결론이 아니라 `state.json` 의 revision 으로 본다. 스크립트는 그렇게 본다.
- `state.json` 의 dev 기록이 `result: failure` 면 revision 은 실패한 배포다. 마지막 성공은 그 파일로 알 수 없다. 4절로 본다.
- 서버 문서(`.md`)만 바꾼 머지는 서버마다 다르다. data-api·business-api·notification 문서는 dev 에 다시 배포된다(data-api 면 Realtime 도). realtime 문서는 도는 dev CI 가 없어, 다음 realtime 배포까지 realtime 이 「아직 안 감」으로 남는다. 정상이다([파이프라인 지도](../../../docs/engineering/pipeline-map.md) 1절).
- `state.json` 의 `prod/catus` 와 `prod.json` 은 운영 V1 기록이다. 운영 V2 는 `prod-V2/<역할>.json` 이다.
- 운영 기록은 성공한 배포만 남긴다. 승인 대기·거부·실패·취소된 실행은 줄 끝의 「최근 실행」으로만 보인다. release 의 최근 `prod-cd-V2` 실행이 `completed`·`success` 가 아니면 다음 성공 실행까지 앱 출시 게이트(`app-server-gate.py`)가 막는다. 거부로는 풀리지 않는다.
- 운영 단위의 기록 시각은 그 태그가 기록 파일에 들어간 때다. 같은 태그를 다시 배포하면 바뀌지 않는다. 다시 배포한 때는 「최근 실행」으로 본다.
- 피처 브랜치(에픽)로 머지한 PR 은 그 커밋이 main 에 스쿼시돼 기록에 들어가지 않는다. 그 브랜치를 main 에 넣은 PR 번호로 본다.
- release 대상 PR(승격)은 운영 단위만 본다. dev·백오피스는 main 머지로 배포되므로 main 쪽 PR 로 본다.
- 태그 숫자 크기로 최신을 판단하지 않는다(파이프라인 지도 「버전 축」).

## 4. 더 깊게 (조회만)

- dev 호스트 저널: `gcloud compute ssh catus-dev-v2-app --project oneorthree2 --zone asia-northeast3-a --tunnel-through-iap --command 'cat /opt/catus-dev-v2/app/deployment-journal.json'`
- dev 성공 기록 원본: `gcloud storage cat gs://catus-dev-v2-deploy-263851348176/deployments/app/current.json`
- dev V2 는 Datadog 에 보고하지 않는다. `env:dev` 는 옛 dev VM 이다.
- 운영 성공 기록 원본은 S3 `deployments/<역할>/current-V2.json` 이다(파이프라인 지도 「환경」).
- 운영 CD 실행: `gh run list --workflow prod-cd-V2.yml --branch release -L 3`
