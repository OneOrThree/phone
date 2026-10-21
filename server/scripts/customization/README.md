# 집중 꾸미기 보상 등록 데이터

2313은 승인된 90종의 카탈로그·그림 자료와 확률 설정을 등록한다.
세션 정산에서 추첨·지급하는 로직은 2301, 획득 표시·보관함·장착 연결은 2311의 후속 범위다.
이 변경만 배포해도 보상이 나오거나 새 그림이 앱에 표시되는 것은 아니다.

## 등록 내용

- `server/data-api/src/main/resources/customization/reward-catalog-v1.json`: 90종의 서버 ID, 원본 ID, 이름, 희귀도, 렌더 자료와 정적 파일 SHA-256 목록.
- `server/static/customization/`: 승인된 원본 PNG·자세 보정 JSON·이식 참고용 합성 코드. 파일 내용은 변경하지 않고 이름에 SHA-256 앞 8자를 붙였다.
- V133: `customization_reward_policies`, `customization_reward_items`.
- V134: 정책 revision 1과 `catalog_assets` 90종, `customization_reward_items` 90행을 등록한다.
- V135(GROMO-2301): 정책 revision 2 — 확률은 같고 신발·뗏목 6분류를 뺀 머리·목 20종만 뽑는다. 정산은 가장 큰 revision 을 쓴다. 추첨은 정산 때 서버 난수로 한 번 하고 결과를 `focus_settlements` 에 고정한다(세션 id 로 미리 계산할 수 없다). 신발·뗏목은 revision 1 에 등록만 돼 있고 지급되지 않는다.
- `reward-design.json`: 승인 엑셀에서 추출한 입력. 파일 해시로 출처를 식별한다.
- `probability-fixtures.json`: 같은 엑셀에서 계산한 13개 시간의 등급 확률. 2301에서도 호환성 검증에 사용할 수 있다.

기존 `sea_reward_tiers`는 수정하지 않는다. 이전 엔진에 90종을 단계 보상으로 넣으면 한 번에 여러 개를 지급하거나 보유 상품을 제외할 수 있기 때문이다.
원본 시트·뗏목 배치를 기존 `customization_asset_meta`의 고양이 정적 오버레이로 오등록하지 않는다.
새 목록의 그림 정보는 `customization_reward_items.render_data`에 보존하며, **기존 `GET /customization/catalog`는 아직 이 목록을 반환하지 않는다.**

## ID와 분류

| 제작 분류 | catalog_assets.kind | 서버 ID 예 |
|---|---|---|
| 머리 위 소품 | head | `cust.head.mandarin` |
| 목 장식 | neck | `cust.neck.shell` |
| 신발 | shoes | `cust.shoes.cloud` |
| 깃발·깔개·노·짐·램프·차양 | decor | `cust.decor.flag-fish`, `cust.decor.mat-picnic` |

뗏목은 개인 소유 장식이므로 `kind=decor`, 세부 구분은 `category`에 남긴다.
**이것이 기존 decor 슬롯 하나에 6분류를 합쳐 장착한다는 뜻은 아니다.**
앱·서버 장착 모델이 6분류를 각각 지원하도록 연결하는 작업은 별도다.

기존 `cust.head.duck`은 오리 모자이므로 보존한다. 새 오리 인형은 `cust.head.duck-plush`다.
다른 기존 ID와 이름·종류·소유자가 충돌하면 V134 전체를 실패시킨다. 이미 존재하는 상품의 의미를 바꾸지 않는다.

## 확정 정책과 계산 계약

한 세션의 휴식을 뺀 `activeSeconds`를 사용한다. 이전 세션의 시간을 더하지 않는다.

| 초 | 지급 개수 | 후보 등급 |
|---|---|---|
| 0~899 | 0 | 없음 |
| 900~1799 | 1 | 일반·고급 |
| 1800~3599 | 1 | 일반·고급·희귀 |
| 3600 이상 | 1 | 일반·고급·희귀·전설 |

이미 받은 상품도 동일한 후보에 포함한다. 해금은 그 등급의 당첨 보장이 아니다.
지급 판정은 낚시섬 `ISLAND`, 바다 `SEA` 모두에 적용하며 목적지 도착 여부는 보지 않는다.
같은 세션의 종료 요청 재시도로 새로 추첨하거나 다시 지급하면 안 된다.

| 해금 적용 전 기본 가중치 | 일반 | 고급 | 희귀 | 전설 |
|---|---:|---:|---:|---:|
| ISLAND | 48 | 30 | 18 | 4 |
| SEA | 66 | 26 | 7 | 1 |

1. 기본 가중치를 각 장소별 합계로 나눠 확률로 바꾼다.
2. `extraSeconds = max(0, activeSeconds - 900)`, `factor = extraSeconds / (extraSeconds + 7200)`.
3. 희귀에 `0.03 × factor`, 전설에 `0.01 × factor`를 더한다. 일반에서 가산 합계를 빼고 고급은 유지한다.
4. 아직 해금되지 않은 희귀·전설은 0으로 바꾼다.
5. `remaining = 1 - 희귀 - 전설`을 3번에서 구한 일반·고급 비율대로 배분한다.
6. 카테고리를 공통 가중치(현재 모두 1)로 뽑고, 그 카테고리에서 장소·시간에 따른 등급을 뽑고, 해당 등급 안에서 균등 추첨한다.

한 아이템 확률은 `카테고리 가중치 / 전체 카테고리 가중치 합 × 등급 확률 / 같은 카테고리·등급 품목 수`다.
품목 수는 현재 각 분류에서 일반 4·고급 3·희귀 2·전설 1이다.
15분 이상이면 합계 100%이며 꽝 항목은 없다.
설정의 `rare_max_bonus_ppm=30000`, `legendary_max_bonus_ppm=10000`은 각각 최대 +3%p, +1%p다.

중복 추첨과 중복 요청은 구분해야 한다. 기존 `owned_products`의 `(user_id, product_id)` 유일 제약은 유지돼 있다.
2301은 세션별 획득 결과를 따로 남겨 기존 보유 상품도 당첨 결과에 포함하고, 최초 소유 행만 추가해야 한다.
중복 수량 표시·교환 보상은 이 정책에서 새로 정하지 않았다.

15분 반복으로는 희귀를 받을 수 없다. 다만 30분 2회가 60분 1회보다 희귀 이상을 한 번이라도 얻을 확률은 높을 수 있다.
60분은 전설 후보가 열리는 이점이며, 모든 시간당 보상을 긴 세션에 유리하게 만든 설계는 아니다.

## 그림 정보 읽기

`renderData.source`의 `width/height`는 원본 PNG 픽셀 크기, `crop=[left,top,right,bottom]`은 알파 영역이다.
`right/bottom`은 제외 경계다. JSON 좌표는 앱에 바로 쓸 정규화 앵커가 아니라 명시된 `coordinateSpace` 안의 픽셀이다.

### cat-fit-v1

- 좌표계: `black-cat-512`, 512×512.
- 검증 대상: 검정 고양이 `walk` 6프레임, `focus` 4프레임, `reel` 4프레임.
- 머리: `contactFrames`의 x/y/각도에 `itemDepthY`를 더하고 `drawWidth`로 알파 크롭을 그린다. reel-2의 추가 이동을 이미 반영했다.
- 목: `rigPath`의 목 곡선·가림 영역, `views`의 목줄·앞 장식 영역, `neckStyle`을 함께 사용한다. 펜던트의 공통 목줄은 `commonBand`.
- 신발: `views`의 옆·앞·밑창 시점과 `rigPath`의 발별 행 변형 자료를 함께 사용한다.
- `referenceCode`의 `fitting.js`는 승인 합본의 합성 알고리즘 참고본이다. 앱 런타임으로 자동 실행하지 않는다.

1254×1254 정적 오버레이를 쓰는 기존 API와 좌표계가 다르다. PNG 전체나 시트를 고양이 위에 한 장으로 얹지 않는다.
다른 털색·체형, 책 읽기·웅크리기 자세는 이 합본에서 검증되지 않았다. 해당 자세의 자료를 만들기 전까지 임의로 걷기 좌표를 재사용하지 않는다.

### raft-fit-v1

- 좌표계: `review-scene-800x620`, 800×620.
- `placements.isometric/side`는 합본의 두 뗏목 시점별 위치·폭·회전·가림 순서다.
- 깔개는 `sideSource`가 있으면 항해 시점에서 교체한다. 체크 돗자리는 두 시점 모두 추가 회전 0도다.
- 노는 기본 노가 없는 `replacementRafts`와 함께 쓴다.
- `renderer-base.js`는 배·고양이·낚싯대와의 상대 배치를 포함한 참고본이다.

위치는 합본 기준이며 실제 앱 장면의 좌표로 변환해야 한다. 뗏목 6분류 장착 API 및 앱의 낚싯대 상호작용 검증은 이번 데이터 등록에 포함하지 않는다.

## 재생성과 검증

저장소 루트에서:

```sh
python3 server/scripts/customization/build_reward_catalog.py /path/to/customization-assets-2026-10-16
python3 server/scripts/customization/validate_reward_catalog.py
```

생성기는 원본 합본을 수정하지 않으며 DB에 접속하지 않는다.
V134는 아직 배포되지 않은 작업 중에만 재생성한다. 머지·적용 후 변경은 새 migration과 revision을 사용한다.
적용 순서는 정적 파일 배포 → V133/V134 적용 → 2301·앱 어댑터 연결이다. 운영 DB 직접 적용은 하지 않았다.

```sh
cd server/data-api
./gradlew test --tests '*CustomizationRewardCatalogMigrationTest' \
  --tests '*CustomizationV128MigrationTest' --tests '*SeaFocusV117MigrationTest' checkstyleTest
```

검증은 이미지 해시·크기·크롭·14자세 자료, 엑셀 경계값과 확률 합계, DB 등록 개수·ID 충돌·이전 데이터 보존을 확인한다.
이 검증이 실제 앱에서 모든 장착 조합을 확인했다는 뜻은 아니다.
