# 목표 아키텍처 (서비스 · 시스템)

서버 분리 라운드가 끝났을 때(Target-1)와 그 다음(Target-2)의 정본. 새 서비스·새 통신 경로·새 저장소를 추가하기 전에 이 폴더의 규칙과 어긋나지 않는지 먼저 본다.

| 문서 | 답하는 질문 |
|---|---|
| [`service-architecture.md`](service-architecture.md) | 어떤 프로세스가 무엇을 소유하고 누구를 부르나 — 단방향 규칙 · 통신 방식 · 인증 경계 · 배치의 자리 |
| [`system-architecture.md`](system-architecture.md) | 어디에 떠 있고 어떻게 배포·관측하나 — 환경 실측 · 노출면 · DB · CI/CD · Target-2 진입 조건 |
| [`decisions.md`](decisions.md) | 왜 그렇게 정했나 — 결정 장부 A1~A19 (**충돌 시 정본**). 본문의 숫자 티켓은 Jira `GROMO-####` |
| [`diagrams/`](diagrams/) | 직각 연결선 SVG 6장 — 서비스 구도 · 랭킹 3시점 · 배치 · 레포 |

## 한 문장

**앱은 Business API 하나만 본다. 데이터는 Data API 만 만진다. 알림과 링크는 자기 데이터만 갖고, 코어를 부르지 않는다.**

## 그림

![Target-1 서비스 구도](diagrams/01-service-target1.svg)

## 규칙 요약

- 위성(알림 · 링크)은 코어를 부르지 않는다. 코어가 위성에 밀어준다(이벤트 · 발급 시 스냅샷 동봉). 예외는 알림 → Data API **조회 3종**(리컨실 · ack 수렴 · 발송 적격)뿐이다.
- 이벤트 발행 주체 = 그 유스케이스를 완료한 프로세스 (요청형 Business API · 정산형 Data API).
- 배포 단위는 레포가 아니라 이미지. 서비스 하나가 바뀌면 그 이미지만 빌드·교체, 롤백은 직전 digest.
- Target-2 로 가는 신호는 감이 아니라 수치 — `system-architecture.md` §7.

## 새 서비스를 붙일 때 — 8단계 순서대로

1. **어느 무리인가** — JVM 이면 `oneorthree/server` 의 `services/<name>/`(A17), 스택이 다르면 별도 레포. 서브모듈은 쓰지 않는다(A15).
2. **누구를 부르고 누가 부르나** — `service-architecture.md` §3 허용/금지 표에 새 행·열을 추가한다. 위성이면 코어를 부르지 않는다. 필요한 사실은 이벤트·발급 시 동봉하고, 정합은 리컨실로.
3. **무엇을 소유하나** — §7 데이터 소유 표에 저장소를 등록한다. 코어 database 는 Data API 만. 자기 데이터가 있으면 같은 RDS 의 별도 database(A10). Redis 를 쓰면 키 네임스페이스와 쓰기 소유자를 정한다(A19). **기존 데이터를 넘겨받으면 해당 리소스의 계약을 이관 계획에 포함한다 — 알림은 §7.1.1 의 미발송 payload 보강·검증과 §7.1.2 의 발송 게이트·실패 복귀, 클릭은 §7.2 의 병합·검증(A22 ㋬~㋮).**
4. **이벤트를 내나 받나** — 발행 주체 = 그 유스케이스를 완료한 프로세스. 봉투 필드는 **서비스 아키텍처 §4 의 정본 목록을 그대로 쓴다**(`eventId` · `schemaVersion` · `type` · `occurredAt` · `scheduledAt` · `userId` · `locale` · `subjectId` · `version` · `params`) — 여기에 요약본을 따로 두면 어긋난다. 소비 측 멱등은 `eventId`, 순서 거부는 `version`(컬렉션 투영은 `subjectId` 별), 스키마 호환은 `schemaVersion`.
5. **어떻게 뜨나** — `system-architecture.md` §2.2 자원표(포트·힙)·§2.4 시크릿·§3 CI 경로 필터·§4 `DD_SERVICE` 에 한 줄씩 추가하고, 메모리 합계가 인스턴스를 넘지 않는지 A14 기준으로 계산한다. **시크릿은 저장소 등록 → 서비스별 env 출력 → compose 주입까지 합성 값으로 검증한다(A22 ㋯).**
6. **밖에서 닿아야 하나** — 외부(앱·Vercel 콘솔·웹훅)가 부르는 경로가 있으면 `system-architecture.md` §2.1 공인 노출면 표에 행을 추가하고 nginx 라우팅·인증 방식을 적는다. 없으면 "노출 0"을 명시한다(data-api 처럼).
7. **그림을 고친다** — mermaid 소스 둘(`service-architecture.md` §1, `system-architecture.md` §2 — 6단계의 nginx 라우팅이 여기 그려진다)과 그 정적 사본 `diagrams/01-service-target1.svg`·`05-deploy-target1.svg`(필요 시 랭킹 `02~04`)에 상자·화살표를 추가한다. 그림·허용 표·본문 셋이 같은 화살표 집합이어야 한다 — 리뷰 기준이다.
8. **결정을 남긴다** — 위에서 규칙을 바꾼 게 있으면 `decisions.md` 에 A 번호로.

## 바꾸는 법

결정을 바꾸려면 `decisions.md` 에 A 번호를 추가하고(뒤집힌 항목은 취소선 + 후속 번호), 두 문서를 그에 맞게 고친 뒤 `doc/fix-prd-architecture` 브랜치로 PR 을 연다.

- Kafka 소비자를 붙일 때 `.DLT` 접미사·원본 파티션을 명시하고, 실패 토픽 장애 시 원본 offset이 보존되는지 실제 브로커로 검증한다(A22 ㋱). Spring Kafka 4의 기본 `-dlt`에 맡기지 않는다.
- 응답 유실 재시도에서는 RT 로그아웃·갱신 capability·기기 토큰 교체가 같은 명령으로 수렴하는지 확인한다(A22 ㋲). 오프라인 연속 등록의 소유권 승계, RT 회전 뒤 재생, 구 앱의 gen 포함 AT 등록과 동일 로그인 세션 승격도 검사하며, 다른 세션 또는 이미 전송한 명령의 본문은 바꾸지 않는다. 정적 경계는 `.github/scripts/check-satellite-contracts.py`, 실행 보장은 각 서비스의 DB·Kafka·앱 재시도 테스트가 검사한다.
- 최종 전체 스냅샷의 식별자를 모든 청크와 verify/open에 전달하고, 같은 버전 opt-out·구성원 감소·빈 집합·부분 적재·라이브 행 보존을 검증한다(A22 ㋼).
- 이관 직렬화는 양 서비스의 실제 라이브러리로 체크섬을 대조하고, 빈 자원·제어문자·미래 이월 알림도 검증한다(A22 ㋳).
- 초기 user·participation 투영까지 다섯 자원을 대조하고 같은 원본 재적재·탈퇴 fence를 검사한다(A22 ㋶). Link 이관은 LEGACY 귀속과 필드별 표시 version을 복원한다(A22 ㋷·㋸).
- ack 보류 해제 후 같은 키 재시도, 첫 후보의 렌더 오류, 보류 후보 25개 뒤의 정상 발송, 모집·종료 사건 수신과 flush의 교차, import와 open의 경합을 실제 DB에서 검증한다(A22 ㋴). 계정 전환 중 부분 저장과 rollback에는 이전 RT 폐기 명령을 함께 대조한다(A22 ㋵).

Link/MMP의 실제 저장소는 [OneOrThree/mmp-custom](https://github.com/OneOrThree/mmp-custom)이다(A17). 알림은 현재 `server/notification/`에 유지하며 최종 JVM 레포 경로 전환은 1695와 맞춘다. 기존 파일 미리보기 캐시의 Target-1 예외와 ACL은 A22 ㋺를 따른다.

- Kafka 로그·KRaft 메타데이터 경로와 영속 볼륨 경로가 같은지 확인하고 컨테이너 재생성 후 메시지를 읽는다(`test_kafka_persistence.py`). FCM `UNREGISTERED`만으로 성공 이력이 없는 알림을 완료 처리하지 않는지도 검사한다(A22 ㊚).

- 설정 동시 변경은 실제 PG의 잠금 대기와 최종 행·봉투를 대조한다(A22 ㋕). 앱 업그레이드 후 첫 등록 전 로그아웃은 SDK 토큰 정리 경로의 사전 배선과 조회 실패 시 RT 폐기 유지를 검사한다(A22 ㋲).

- 내부 HTTP 서킷은 정상 4xx와 시간 예산 부족 이후에도 복구되는지 검사한다(A22 ㋽, `InternalHttpClientRecoveryTest`).

- 게이트 재시도의 실제 drain·닫힌 상태 보호·새 키 재개와 멤버 역할 변경의 동시 표시 버전 보존을 검사한다(A22 ㋾·㋻).

- 운영 Business env 생성 시 `LINK_PROXY_SECRET` 누락·빈 값 차단을 검사한다(A22 ㋯).
- 두 기기 로그인 뒤 각 세션의 refresh·회전·개별 로그아웃을 검사하고, 잘못된 소유권 값이 outbox를 막거나 삭제 범위를 넓히지 않는지 검사한다(A22 ㋣·㋗).
