# PostHog 지표별 집계 기준

## AI 집중측정 사용 상태

이벤트: `focus_verification_state_observed`. 2026-11-01 앱 코드 연결 및 [2주 집중과 생활 변화 대시보드](https://us.posthog.com/project/669473/dashboard/2220995) 비교 카드 게시를 완료했습니다. 새 빌드의 실제 이벤트 수신은 아직 확인하지 않았습니다.

| 속성                       | 값·의미                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `analytics_schema_version` | `1`                                                                       |
| `focus_location`           | `fishing_island` 고정                                                     |
| `focus_phase`              | `before_focus` / `focusing`                                               |
| `measurement_state`        | `on` / `off` — 현재 측정 설정                                             |
| `preview_state`            | `open` / `closed` — 현재 미리보기 표시 선택                               |
| `measurement_changed`      | 같은 계정의 직전 관측보다 측정 설정이 바뀌었으면 `1`, 최초 관측은 `0`     |
| `preview_changed`          | 같은 계정의 직전 관측보다 미리보기 표시가 바뀌었으면 `1`, 최초 관측은 `0` |
| `observation_reason`       | 화면 진입·계정 전환 `screen_opened`, 설정 변경 `state_changed`            |

- 집중 전·집중 화면의 제어가 마운트될 때 처음 한 번 기록하므로 스위치를 한 번도 누르지 않은 OFF 사용자도 관측합니다. 상태가 실제로 바뀔 때 다시 기록하고, 단순 재렌더·카메라 방향 변경·권한 확인 중간 상태는 중복 전송하지 않습니다. 측정 OFF에서 미리보기를 누르면 안내만 띄우므로 ON/열림 이벤트를 보내지 않습니다. 권한 거절도 ON/열림 성공으로 보내지 않습니다.
- 집중 중 사용자는 `focus_phase=focusing`으로 필터합니다. 최초 관측은 시작 또는 복귀 화면 진입이며 새 서버 집중 시작 횟수를 뜻하지 않습니다. 기존 `focus_started` 계약은 변경하지 않습니다.
- ON 사용자 수는 `measurement_state=on`, OFF 사용자 수는 `off`, 미리보기 사용자는 `preview_state=open`의 고유 사용자 수로 집계합니다. 기본 OFF와 끈 행동을 구분하려면 OFF에 `measurement_changed=1`을 추가합니다. 미리보기를 새로 연 행동에는 `preview_changed=1`을 추가합니다.
- 같은 사용자가 기간 중 ON/OFF 양쪽에 나타날 수 있습니다. 서로 겹치지 않는 현재 상태 분류는 기간 내 사용자별 최신 관측 하나를 고른 뒤 측정·미리보기 상태로 나눕니다. 이벤트 수를 사용자 수로 사용하지 않습니다. 이번 게시 카드는 각 상태를 경험한 사용자 수이므로 배타적 최신 상태 분류가 아닙니다.
- 분모는 이 이벤트가 관측된 사용자입니다. `EXPO_PUBLIC_VERIFY_SPIKE=1`로 기능이 표시되는 낚시섬 경로만 대상이며 바다·튜토리얼·기능 미노출 사용자를 OFF로 추정하지 않습니다. 운영 환경·기존 테스트 계정 제외 규칙을 적용합니다.
- 설정 ON은 실제 촬영·판정 성공의 증거가 아닙니다. 미리보기 열림도 실제 프레임 표시나 누적 표시 시간을 보장하지 않습니다. 이 이벤트만으로 사용 시간·배터리·정확도를 계산하지 않습니다. 세션 종료·화면 이탈을 OFF 또는 닫기 행동으로 합성하지 않습니다.
- 영상·이미지·손/물체 점수·집중 판정·인증 시간·비율·과목명·별도 계정 ID를 속성에 넣지 않습니다. 식별과 환경 제외는 기존 PostHog 연결을 사용하며 프레임별·초별 전송이나 별도 디스크 저장을 추가하지 않습니다.

게시 인사이트는 `CJ8K1PRL`(측정 ON/OFF)과 `jwdHMWw9`(측정·미리보기 네 조합)입니다. 두 카드 모두 네이티브 `TrendsQuery`, 고유 사용자(`dau`)의 기간 전체 막대 비교, 최근 14개 UTC 날짜를 사용합니다. 승인 전 카탈로그 정의는 `focus_verification_measurement_users`, `focus_verification_preview_combination_users`이며 현재 `proposed`입니다. 실제 수신을 확인한 뒤 카드의 수집 대기 표시를 갱신합니다.

대시보드는 집계 대상과 데이터의 의미를 짧게 설명합니다. 아래는 각 저장된 인사이트의 상세 집계 기준입니다. 화면의 안내를 줄여도 쿼리와 집계 범위는 변경하지 않습니다.

첫 여정 이벤트 4개는 앱 계측 추가가 필요하고, 오류·크래시 3개는 새 운영 빌드 적용과 수신 확인이 필요합니다. 구현 상태와 이벤트 계약은 [README.md](README.md)를 참고합니다.

현재 저장된 17개 쿼리는 내부·테스트 계정 제외 설정을 사용합니다. SQL 지표는 `filtered_events`에 이 필터를 적용한 뒤 각 지표의 기간·조건으로 집계합니다.

## 첫 섬 도착까지

인사이트 ID: `12957826`

계정별 첫 first_island 여정의 고유 사용자 순서 퍼널입니다. 미인증 이탈을 포함하며 로그인 전 기존 사용자 판별에는 한계가 있습니다. 경로 선택·승인대기 화면은 필수 단계가 아닙니다. 7일 관찰창의 단계 인원·이탈·전환율과 PostHog 기본 전환시간 기능을 사용합니다.

## 섬 진입 경로별 도착률

인사이트 ID: `12957827`

SDK가 계정 첫 first_island 여정의 최초 선택 entry_path를 고정하고 island_route_selected milestone을 한 번만 발행한다는 계약을 전제로 경로별 7일 퍼널을 표시합니다. first_touch 옵션만으로 생애 최초 선택을 보장하지 않습니다. 승인대기는 멤버십 미확정이며 최근 진입자는 관찰 진행 중입니다.

## 첫 집중 시작과 완료

인사이트 ID: `12957828`

인증된 계정의 첫 first_island 여정에서 섬 도착→안내 종료(completed/skipped)→첫 실제 서버 집중 시작→첫 실제 정산 완료를 보는 7일 고유 사용자 퍼널입니다. 안내용 체험은 제외하며 개별 세션 완료율이 아닌 사람 전환입니다.

## 첫 집중 후 다시 집중한 비율

인사이트 ID: `12957829`

production 첫 first_island 여정의 유효 first_focus_completed 최초 milestone을 최근 28일 KST cohort로 사용합니다. 같은 날 추가 집중은 제외하고 D1·D7·D1~D7 다른 날 focus_completed 재집중을 봅니다. 목표일이 끝난 성숙 분모만 사용하며 milestone 없는 기존 사용자는 제외됩니다.

## 최근 7일 이용과 집중 습관

인사이트 ID: `12957028`

production 인증 사용자(게스트 포함), KST 오늘 포함 최근 7일 고정창. person_id 중복 제거. 집중 습관은 서로 다른 3일 이상 focus_completed. 활성·집중 표본이 없으면 NULL/데이터 없음이며 SQL에 지정된 최근 기간을 기준으로 집계합니다.

## 매일 이용한 사람과 집중한 사람

인사이트 ID: `12957029`

production, KST 오늘 포함 최근 28일 고정창. 날짜별 distinct person_id이며 오늘은 부분 집계입니다. 이벤트 없는 날짜는 0으로 채우지 않고, 해당 지표 표본이 없는 날은 NULL입니다. SQL에 지정된 최근 기간을 기준으로 집계합니다.

## 집중한 사람의 하루 집중시간

인사이트 ID: `12957037`

production, KST 최근 28일. 사용자·날짜별 duration_seconds>0 합계를 먼저 구한 뒤 유효 집중완료 사용자 간 평균·중앙값을 계산합니다. 분모는 당일 유효 focus_completed 사용자이며 전체 활성 사용자 대비가 아닙니다. SQL에 지정된 최근 기간을 기준으로 집계합니다.

## 섬 소속과 표류 중인 사람

인사이트 ID: `12957030`

production 최근 28일. app_active 또는 social_state_observed 사용자를 합친 뒤 최신 스냅샷 1인 1행으로 소속/표류/미확인/스냅샷 없음을 구분합니다. 반복 관측은 가중하지 않으며 표류는 소속 섬 0개입니다.

## 섬 상태별 다음 날·7일 뒤 재방문

인사이트 ID: `12957031`

production 최근 28일 첫 social_state_observed 당시 상태를 고정합니다. 신규가입 리텐션이 아닌 기간 내 첫 관측 기준입니다. KST 정확히 1일/7일 뒤 app_active이며 목표 날짜가 완전히 지난 성숙 코호트만 각 분모에 포함합니다. 분모·재방문자·율을 함께 표시합니다.

## 친구는 평균 몇 명일까

인사이트 ID: `12957034`

production 최근 28일 최신 social_state_observed 1인 1행. friend_count가 알려진 사용자만 평균·중앙값·0명 비율의 분모이며 실패 unknown은 제외하고 미확인 인원으로 별도 표시합니다. 수락 친구만 포함하며 전체가입자 평균이 아닙니다.

## 친구 수별 사용자 분포

인사이트 ID: `12957035`

production 최근 28일 최신 social_state_observed 1인 1행. friend_count 성공값으로 0/1/2~4/5+를 분류하고 실패·누락은 미확인으로 표시합니다. 반복 관측은 가중하지 않으며 친구 화면 방문자만 집계한 값이 아닙니다.

## 친구 수별 7일 뒤 재방문

인사이트 ID: `12957036`

production 최근 28일 첫 스냅샷이 member인 사용자만, 당시 친구 구간을 고정합니다. KST 정확히 7일 뒤 app_active, 목표일이 완전히 지난 성숙 코호트만 분모입니다. 신규가입 리텐션이 아니며 관찰 상관관계일 뿐 친구의 인과효과가 아닙니다. 표본수를 함께 봅니다.

## 섬에 합류한 방법

인사이트 ID: `12957038`

production 최근 28일 island_membership_activated의 method별 distinct person_id. 생성(created)·가입(joined)·승인(approved)을 구분합니다. 같은 사용자가 여러 방식에 나타날 수 있어 막대 합계는 전체 고유 사용자 수가 아닙니다.

## 오류와 크래시를 겪은 사람

인사이트 ID: `12957830`

최근 28일 KST $exception의 일별 distinct 사용자 추이입니다. 오류 영향 사용자는 fatal을 포함하며 fatal 크래시 사용자를 별도 표시합니다. JS는 before_send로 모든 이벤트에 analytics_environment를 부여합니다. 네이티브 직접 전송은 환경 속성이 없으므로 $lib=posthog-react-native 이고 level=fatal인 미태깅 이벤트만 production 범위에 포함합니다. nativeCrashes와 androidNdkCrashes는 production에서만 활성화하고 dev/staging에서는 비활성화하는 계약입니다. 빌드 적용 및 런타임 수신은 아직 미검증입니다.

## 크래시를 겪은 사용자 목록

인사이트 ID: `12957831`

최근 28일 production level=fatal 사용자 최대 50명입니다. fatal JS와 iOS native, Android Java/Kotlin/NDK만 대상으로 하며 일반 error/unhandled는 제외합니다. JS는 before_send로 환경을 태깅하고, 미태깅 네이티브는 $lib=posthog-react-native·fatal일 때만 포함합니다. nativeCrashes/androidNdkCrashes는 production에서만 켭니다. NDK 크래시는 다음 실행 때 수집·전송되어 사용자·앱 버전이 발생 시점이 아닌 발견 시점 값일 수 있습니다. 빌드 적용·런타임 수신은 미검증입니다.

## 앱 버전·OS별 오류

인사이트 ID: `12957832`

최근 28일 production 범위의 $exception을 앱 버전·OS별로 집계합니다. 오류 영향 사용자, fatal 영향 사용자, exception 수를 구분합니다. JS는 before_send로 analytics_environment를 부여하고, 미태깅 네이티브 직접 전송은 $lib=posthog-react-native 이고 level=fatal일 때만 포함합니다. nativeCrashes와 androidNdkCrashes는 production에서만 활성화하고 dev/staging에서는 비활성화하는 계약입니다. 로그인 전 크래시도 포함하며 미설정 값은 미확인입니다. 빌드 적용 및 런타임 수신은 아직 미검증입니다.

## 섬·친구 데이터 수집 상태

인사이트 ID: `12957039`

production 최근 28일 app_active와 최신 social_state_observed 기반 관계 상태 계측 커버리지입니다. 이 카드는 기존 관계 관측만 진단하며, 신규 activation_step과 오류·크래시 수집 준비 여부는 각 대시보드 상단의 수집 준비 안내를 확인합니다. 표본 미수신은 실제 사용자가 0명이라는 뜻이 아닙니다.
