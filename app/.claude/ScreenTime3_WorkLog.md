# Gromo 스크린타임 사용량 버킷 Work Log (3)

> 스크린타임 **표시** 기능은 [ScreenTime_WorkLog.md](./ScreenTime_WorkLog.md),
> **목표 판정·보상** 기능은 [ScreenTime2_WorkLog.md](./ScreenTime2_WorkLog.md) 참고.
> 이 문서는 **"하루 사용량을 수치로 수집해 서버로 보내는" 버킷 파이프라인**과
> 그 발전 방향(측정 간격 세분화)을 다룬다.

---

## 개요

iOS는 "지금까지 몇 분 썼는지"를 앱이 직접 읽는 API를 주지 않는다. 대신
**"누적 사용이 X분에 도달하면 깨워줘"라는 알람(threshold 이벤트)을 미리 등록**하는
방식만 허용한다. 그래서 gromo는 30분·60분·90분·…·900분(15시간)까지 **30개의 눈금**을
사다리처럼 걸어두고, 눈금에 도달할 때마다 Monitor 익스텐션이 "오늘 최소 X분"을
App Group에 기록 → 앱이 포그라운드에 올 때 그 값을 읽어 서버로 보낸다.

- 서버에 찍히는 값이 30분 단위(30, 60, 90, …)인 이유가 바로 이 눈금 간격이다.
- **30분은 Apple 제약이 아니라 우리가 정한 상수다.** (아래 §3)

---

## 1. 현재 아키텍처 (30분 버킷)

```
[등록 — 앱 실행/온보딩]
  JS registerUsageBucketMonitoring(900)            screentimeSync.ts:48
  → 네이티브 startUsageBucketMonitoring()          ScreenTimeModule.swift:213~
     · App Group에서 측정 대상(selection) 로드
     · 30분 간격 threshold 이벤트 30개 생성 (step=30, 상한 900)
       이벤트명: "gromo.usage.bucket.30" ~ "gromo.usage.bucket.900"
     · DeviceActivityCenter.startMonitoring (00:00~23:59 반복 스케줄)
     · 호출 '전'에 등록 시각·재등록 베이스라인 기록 (GROMO-871)

[하루 중 — 눈금 도달마다]
  DeviceActivityMonitorExtension.eventDidReachThreshold
                                                   DeviceActivityMonitorExtension.swift:93~152
     · 이벤트명에서 분값 파싱 ("gromo.usage.bucket.<분>")
     · 가드 1: 자정 리셋 놓침 감지 → 전일 최종값 prevBucket 보존 후 자체 리셋 (GROMO-844)
     · 가드 2: 물리적으로 도달 불가능한 눈금이면 폐기 (오발화 가드, GROMO-871)
     · 재등록 베이스 합산: base + mins (재등록은 iOS 카운트를 리셋하므로)
     · App Group에 max 비교로 기록: gromo:screentime:usageBucketMinutes

[자정 00:00]
  intervalDidStart → 전일 최종 눈금 prevBucket 보존 + 오늘 버킷/베이스 리셋

[앱 실행·포그라운드 복귀]
  <ScreenTimeSyncer/> (App.tsx 셸 컴포넌트)        components/ScreenTimeSyncer.tsx
  → syncScreenTimeUsage()                          screentimeSync.ts:173~
     ① 어제분 마감(GROMO-627): prevBucket + 판정 → isFinal: true 로 확정 보고
     ② 밀린 과거분 확정: 히트맵 대조로 빠진 날 backfill (isFinal: true)
     ③ 오늘 중간 동기화(GROMO-633): 값이 변했으면 isFinal: false 로 보고
        (서버는 total만 갱신, 달성 판정·알림은 스킵)
  → saveScreenTime() = POST /api/v1/screen-time    screentimeApi.ts:8
```

핵심 설계 포인트:

- **눈금은 단조증가(래칫)** — 익스텐션은 항상 `max(기존, 신규)`로만 기록하므로
  중복·역행이 없다. 대신 자정 리셋을 놓치면 래칫이 위로만 굳는 문제가 있어
  GROMO-844의 자체 리셋 가드가 들어갔다.
- **서버 전송은 익스텐션이 하지 않는다.** 익스텐션은 App Group에 쓰기만 하고,
  네트워크 전송은 전부 메인 앱(JS)이 포그라운드에서 수행한다.

---

## 2. 코드 지점 레퍼런스

| 항목 | 위치 |
| --- | --- |
| 눈금 간격 `step = 30` | `ios/gromo/ScreenTimeModule.swift:263` |
| 네이티브 상한 클램프 `min(…, 900)` | `ios/gromo/ScreenTimeModule.swift:264` |
| 간격·상한 설계 이유 주석 | `ios/gromo/ScreenTimeModule.swift:257` |
| JS 상한 `USAGE_BUCKET_MAX_MINUTES = 900` | `src/services/screentimeSync.ts:40` |
| 재등록 감지 키(상한값 기준) | `src/services/screentimeSync.ts:53~56` |
| 이벤트명 → 분값 파싱 | `ios/GromoScreenTimeMonitor/DeviceActivityMonitorExtension.swift:113~114` |
| 익스텐션 합산 클램프 `min(base+mins, 900)` (하드코딩) | `ios/GromoScreenTimeMonitor/DeviceActivityMonitorExtension.swift:145` |
| 동기화 트리거(마운트 + AppState) | `src/components/ScreenTimeSyncer.tsx` |
| 서버 업로드 | `src/services/screentimeApi.ts` (POST `/api/v1/screen-time`) |

---

## 3. "30분"의 정체 — Apple 제약이 아니라 설계 선택

`ScreenTimeModule.swift:257` 주석이 근거:

> 30분 간격 눈금(30,60,…). 이벤트 과다(RAM 6MB)·경계 뭉갬 방지로 900분(15h·30개)로 상한.

- `DeviceActivityEvent`의 threshold는 임의 분값이 가능하다. 30분 배수여야 한다는
  Apple 규칙은 없다. **30분 배수는 오스카가 정한 클라이언트 설계값**이며, 서버는
  받은 분값을 그대로 저장할 뿐 배수 가정이 없다.
- 진짜 제약은 **이벤트 개수**다. Monitor 익스텐션은 Apple이 메모리를 **약 6MB**만
  주는 환경에서 돌고, 이벤트마다 측정 대상 토큰 집합이 통째로 복사돼 들어가므로
  메모리가 개수에 비례한다. "30분 × 30개 = 900분"은 그 안에서 보수적으로 잡은 값.
- threshold 콜백 자체도 몇 분씩 지연되거나 뭉개질 수 있어(OS 재량), 간격을
  줄일수록 눈금당 신뢰도는 떨어지는 역설이 있다. 현실적 하한은 **15분** 정도로 본다.

---

## 4. 현재 구조의 한계

1. **정밀도 30분** — 실제 50분 사용 시 서버엔 30분으로 찍힌다(최대 30분 과소 보고).
2. **전송 빈도는 눈금과 무관** — 업로드는 "사용자가 앱을 열 때"만 일어난다.
   눈금을 좁혀도 서버가 더 자주 받는 게 아니라 **받는 값이 더 정밀해질 뿐**이다.
   전송 빈도를 올리려면 별개 작업(예: BGTask, 익스텐션 직접 전송 검토)이 필요하다.
3. **상한 15시간** — 900분 초과 사용은 900으로 클램프된다(§1 래칫 + §2 클램프 지점).

---

## 5. 발전 방향 — 측정 간격 세분화

15시간 상한은 간격과 묶인 값이 아니다("간격 × 개수"일 뿐). 간격을 줄여도
**개수만 감당되면 15시간 커버는 유지**할 수 있다.

### 선택지 1 — 15분 균일 눈금 (15, 30, …, 900 = 60개)

- 장점: 단순. 하루 전체가 15분 정밀도.
- 단점: 이벤트가 2배(60개). 문서화된 개수 제한은 없지만 6MB 안에서 안전한지
  **실기기 검증 필수**(측정 대상을 많이 고른 계정일수록 메모리 부담↑).

### 선택지 2 — 혼합 눈금 (권장)

앞부분만 촘촘하게, 뒷부분은 30분 유지. 예:

```
15분 간격: 15, 30, …, 300   (5시간까지, 20개)
30분 간격: 330, 360, …, 900 (15시간까지, 20개)
→ 합계 40개로 15시간 커버
```

- 정밀도가 필요한 구간은 목표 시간 근처(하루 몇 시간대)다. 12~15시간을 쓰는
  극단 구간에서 30분 오차는 의미가 없으므로, 촘촘함을 필요한 곳에만 쓴다.
- **현재 코드가 균일 간격을 가정하지 않음을 확인했다** — 익스텐션은 이벤트명에서
  분값을 그대로 파싱하고(`DeviceActivityMonitorExtension.swift:113~114`), JS는
  단일 분값만 읽으므로 비균일 눈금이어도 로직 수정 없이 동작한다.

### 변경 시 체크리스트 (함정 포함)

- [ ] `ScreenTimeModule.swift:263` 눈금 생성 루프 수정 (균일 step 또는 혼합 그리드)
- [ ] **재등록 감지 함정**: 기존 사용자 재등록은 "상한값(900) 변경"으로만 감지한다
      (`screentimeSync.ts:53~56`, 키 `screentimeBucketMonitorMaxMinutes`).
      간격만 바꾸고 상한이 900 그대로면 **기존 설치 유저는 재등록이 안 일어나
      계속 30분 눈금으로 남는다.** → 감지 키에 간격(또는 그리드 버전)을 포함하도록
      로직을 함께 수정할 것.
- [ ] 900 하드코딩 지점 확인: `ScreenTimeModule.swift:264`,
      `DeviceActivityMonitorExtension.swift:145`, `screentimeSync.ts:40`
      (상한을 유지하면 값 변경은 불필요하지만 인지하고 지나갈 것.
      익스텐션 주석 일부는 옛 상한 720 기준으로 남아 있음)
- [ ] 실기기 검증: 눈금 발화 정상 여부 + 익스텐션 메모리(6MB) 여유

서버 쪽 가정 점검은 불필요 — 30분 배수는 클라이언트에서 정한 값이고(오스카 결정),
서버는 임의 분값을 그대로 저장하므로 간격이 바뀌어도 서버 수정이 없다.

---

## 관련 티켓

- **GROMO-633** — 버킷 모니터링·중간 동기화 도입
- **GROMO-627** — 어제분 마감(날짜 변경 시 최종값 확정 보고)
- **GROMO-844** — 자정 리셋 누락 시 익스텐션 자체 리셋 가드
- **GROMO-871** — 오발화 가드 + 재등록 베이스 합산 + 상한 확장(720→900)

---

**Last updated**: 2026-07-19 (최초 작성 — 현재 30분 버킷 구조 정리 + 간격 세분화 발전 방향)
