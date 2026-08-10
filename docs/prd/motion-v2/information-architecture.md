# 모션 — IA v2 (델타)

> 2026-08-11 · 배치 GROMO-1474·1475·1476·1482·1491·1493·1494 · 현재 구현 상태 기준
> 세트: [README](README.md) · [정책 v2](policy.md) · [LLD v2](low-level-design.md) · **IA v2** · [시안](ui.html)
>
> **상위 정본은 [`docs/prd/motion/information-architecture.md`](../motion/information-architecture.md)다.**
> 이 문서는 그 §3.x 표면 행과 §6 부채 행의 **델타만** 담는다 — 층 구조(§1)·강도 등급표(§2)·
> 여정 밀도(§4)·reduce 등급 대응(§5)은 **바뀌지 않는다.**

**신뢰 등급** — 🟩 구현됨(현행) · 🟦 이번 작업으로 추가 · 🟨 의도적 예외(토큰 밖) · 🟥 부채(현재 결함)

---

## §3.1 진입 (등급 2) — 델타

| 표면 | 현재 | 이후 | 티켓 |
| --- | --- | --- | --- |
| 리그 순위 리스트 | 🟩 `enterUp` (`RankRowShell.tsx:67` · 마운트 시점 인덱스 고정) | 🟩 **유지** — FlatList 전환 후에도 같다 | 1493 |
| 리그 **친구 그리드** | 🟥 전환 없음 — `sortedFriends.map`(`LeagueScreen.tsx:684`)에 layout prop이 0개다 | 🟦 `itemLayoutAnimation={springify(new LinearTransition())}` | 1493 |
| 통계 꺾은선 차트 진입(draw-on) | 🟥 재생 중 '동작 줄이기'를 켜도 **끝까지 재생된다**(`charts.tsx:132` 1회 래치) | 🟦 재생 중 전환이 즉시 최종 상태로 끊긴다 | 1482 |

> ⚠️ 상위 IA §3.1의 `리그 순위 리스트 | 🟥 즉시 표시 | 🟦 enterUp | PR7` 행은 **이미 해소됐다.**
> 병합 시 위 행으로 교체한다.

---

## §3.2 상태 전이 (등급 1) — 델타

| 표면 | 현재 | 이후 | 티켓 |
| --- | --- | --- | --- |
| 통계 '첫 시작 시각' **조회 실패** | 🟥 실패를 빈 배열로 삼켜 `'아직 기록이 없어요'`로 그린다(`charts.tsx:301`·`:305`) | 🟦 `null`=실패로 들고 **안내 + 재시도**, 자리 높이(`FIRST_START_BODY_H` 184) 유지 | 1474 |
| 화면 사용시간 분석 진행바 | 🟥 '동작 줄이기' 확정이 늦으면 **시작 진행률을 0으로 두고 남은 구간을 두 배속으로** 채운다(`ScreenTimeAnalyzingOverlay.tsx:73-81`) | 🟦 시간에 비례해 **이어가기**(되감기 금지) | 1482 |
| 과목 순서 **드래그 안착** | 🟥 `m.ready && m.reduce`가 미확정을 **모션 허용**으로 취급(`DraggableSubjectRows.tsx:60`) | 🟦 미확정 = **즉시 완료**(드래그 중인 행 제외) | 1482 |
| 리그 순위 재정렬 | 🟩 `rankSwap` — 가로 ±9pt 왕복 궤적 + `M.spring.snappy` originY + zIndex 상승/하강 | 🟩 **유지**([D22](policy.md#d22)) | 1493 |
| 리그 순위 **단계 재생** | 🟩 프레임 계획(순서 + 기록을 함께 단계화) | 🟦 두 불변식이 충돌하는 입력이면 **단계화 생략**([D17](policy.md#d17)) | 1475 |
| 리그 리스트 **컨테이너** | 🟥 `ScrollView`(`LeagueScreen.tsx:373`) — 가상화 없음, 스티키는 자식 인덱스 계약 | 🟦 `Animated.FlatList` + 내 순위 스트립을 **리스트 밖 오버레이**로 | 1493 |

> ⚠️ 상위 IA §3.2의 두 행이 **낡았다.** 병합 시 교체한다.
> - `리그 순위 재정렬 | 🟥 통째 교체 | 🟦 LinearTransition | PR7` → 위 행(`rankSwap`이 이미 붙어 있다)
> - `리그 리스트 펼침 | 🟥 LayoutAnimation(충돌 위험) | 🟦 LinearTransition으로 치환 | PR7` → **해소됨.**
>   `LeagueScreen.tsx:248-251`·`:259`가 `LayoutAnimation.configureNext` 제거를 기록하고 있다.

> 🟨 **`DraggableSubjectRows.tsx`는 레거시 RN `Animated`인 채로 남는다** — GROMO-1492(레거시
> `Animated` 8파일 장부)가 이번 배치에서 제외됐다. `duration: 160`(`:127`·`:206`)은 `M` 토큰이
> 아니고, 그 상태로 미확정 판정만 고친다([D18](policy.md#d18)의 ⚠️ 항목).

---

## §3.3 피드백 (등급 1) — 델타

| 표면 | 현재 | 이후 | 티켓 |
| --- | --- | --- | --- |
| 단순 **실패 통보**(조치 불필요) | 🟥 `Alert.alert` — 실사용 108곳 중 상당수 | 🟦 `tone:'error'` 토스트 ([D19](policy.md#d19)) | 1491 |
| **조치가 필요한** 실패 · 확인 · 분기 선택 | 🟩 `Alert.alert` | 🟩 **유지** | — |

**실측 잔량** (2026-08-11 · `grep -rn "Alert\.alert" --include="*.ts" --include="*.tsx" app/src`)

| 구분 | 개수 |
| --- | --- |
| 전체 | **173** |
| `app/src/legacy/`(동결·제외) | 43 |
| `*.test.ts(x)` 단언(8파일) | 22 |
| **실사용** | **108** (28파일) |
| 그중 `screens/group/components/ChallengeCard.tsx` | **35** |

> ⚠️ 상위 IA §3.3·§6의 **"`Alert.alert` 149곳"은 낡은 수다.** 병합 시 위 표로 교체한다.
> 티켓 본문의 "108곳"은 틀린 게 아니라 **실사용 모집단**의 수다 — `173`(전체)과 섞지 말 것.

---

## §3.4 축하 (등급 3) — 델타

| 표면 | 현재 | 이후 | 티켓 |
| --- | --- | --- | --- |
| **누끼(캐릭터) 완성** | 🟥 `ActivityIndicator` + 정적 텍스트 `'나만의 그로몬 생성 성공'`(`CharacterCreator.tsx:292`·`:322`) — 모션 프리미티브 0개 | 🟦 `ProgressRing` → **완성 리빌**(`M.spring.bouncy` · `M.dur.celebrate`) + `hapticSuccess` ([D21](policy.md#d21)) | 1494 |

**'동작 줄이기' ON에서의 거동**은 상위 IA §5의 등급 3 행을 그대로 따른다 —
**파티클·리빌만 생략하고 완성 통보·햅틱·문구는 유지한다.**

> 상위 §3.4의 `캐릭터 장착 성공` 행(🟦 토스트 + `pop` 리빌)은 **장착**이고, 위 행은 그 앞의
> **생성**이다. 둘은 다른 표면이며 이 배치에서 생성 쪽이 처음 등급을 받는다.

---

## §6 부채 목록 — 델타

### 해소되는 것

| 부채(상위 §6 표기) | 상태 |
| --- | --- |
| `LayoutAnimation` ↔ Reanimated 레이아웃 충돌 위험 (`LeagueScreen.tsx:219,227`) | **해소됨** — `:248-251`·`:259`가 제거를 기록 |
| 성공 통보가 시스템 알럿 (`Alert.alert` 149곳) | **부분 해소 + 수 정정** — 성공 통보 5건은 이관 완료, 잔량은 위 §3.3 표 |

### 새로 기록하는 것

| 부채 | 위치 | 해소 |
| --- | --- | --- |
| 조회 실패를 무데이터로 삼킨다 | `charts.tsx:301`·`:305` | 1474 |
| '동작 줄이기' **미확정 구간 처리가 세 곳에서 제각각** | `ScreenTimeAnalyzingOverlay.tsx:57-110` · `DraggableSubjectRows.tsx:59-76` · `charts.tsx:127-141` | 1482 |
| `m.enter`가 `startFrameOf`를 인라인으로 중복 구현 | `useMotion.ts:109-114` ↔ `constants/motion.ts:280-285` | 1482 |
| **잠복 크래시** — 마지막 프레임 무가드 인덱싱 | `rankSwap.ts:222` | 1475 |
| 순위 목록이 `ScrollView` 안이라 **가상화가 없다** | `LeagueScreen.tsx:373` | 1493 |
| 친구 그리드에 재정렬 전환이 없다 | `LeagueScreen.tsx:684` | 1493 |
| `sortedFriends` 매 렌더 정렬 · `visibleRanking.indexOf` O(n²) | `LeagueScreen.tsx:172` · `:587` | 1493 |
| 캐릭터 생성기에 모션 프리미티브가 0개 | `CharacterCreator.tsx` | 1494 |
| 실패 통보가 시스템 알럿 (실사용 108곳) | 전역 · 35곳이 `ChallengeCard.tsx` | 1491 |
| 🟨 레거시 RN `Animated` 잔존 8파일 | 전역 | **이번 배치 제외**(GROMO-1492) |

---

## 등급 판정이 새로 붙은 표면 (요약)

| 표면 | 등급 | 근거 |
| --- | --- | --- |
| 누끼 완성 | **3 축하** | 사용자가 가장 오래 기다리는 순간 · 결과물이 영구적 · 쿼터로 빈도가 낮다 ([D21](policy.md#d21)) |
| 실패 통보(조치 불필요) | **1 피드백** | 성공 통보와 같은 축 — 성공/실패는 등급 축이 아니다 ([D19](policy.md#d19)) |
| 조회 실패 안내 + 재시도 | **1 전환** | 로딩 → 콘텐츠와 같은 자리를 쓴다. 자리 높이 유지가 계약 ([D20](policy.md#d20)) |
