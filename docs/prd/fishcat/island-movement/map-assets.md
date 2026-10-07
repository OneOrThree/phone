# 맵·에셋 배포 계약 — 타일 맵·manifest·캐시·로딩 순서

작성: 2026-10-07 · 상태: **제안(타일 섬 전환 10/9 의 입력)**. 이동 서버([PRD](prd.md)·[HLD](high-level-design.md))가 입력으로 받는 `mapId+mapVersion`·`layoutRevision` 을 누가 어떤 모양으로 만들고 어떻게 앱까지 보내는지 정한다. 이동 서버 없이도 타일 섬 전환이 먼저 쓴다.

근거(main `9474432f6`): 앱은 원화 1536×1024 한 장을 `resizeMode="stretch"` 로 그리고 [map.json](../../../../app/app-dev/src/assets/village-world/map.json) 의 타일(64px, 24×16)은 읽지 않는다. 섬 코어 에셋 약 142 MB 가 전부 바이너리 번들이며 런타임 다운로드·캐시·해시 검사가 없다. 서버에는 좌표·배치 버전이 없고 [`/screens/home`](../../../../app/app-dev/src/services/api/home.ts) 은 완공 건물 id 목록과 `island.version` 만 준다. Business API 는 전 응답 `Cache-Control: no-store` 다.

## 1. 세 수명의 데이터

| 층 | 식별자 | 정본 | 바뀌는 때 | 크기(산술) | 전달 길 |
| --- | --- | --- | --- | --- | --- |
| 기본 지형·타일셋 | `mapId` + `mapVersion` | 맵 빌드 파이프라인(오프라인) | 릴리스마다 | 타일셋 PNG 0.5~2 MB, 지형 JSON 수십 KB | 정적 불변 URL, 1년 캐시 |
| 섬 배치 | `islandId` + `layoutRevision` | Data API | 방장이 지을·철거할 때 | 수 KB JSON | `/screens/home` 응답 + `island.updated` |
| 통행 산출물 | `navRevision` + `contentHash` | Movement 컴파일러(후속). 그 전에는 빌드 때 같은 모양으로 계산 | 배치가 바뀔 때 | 100×100 bitset 1,250 B + 비용 10,000 B | 정적 불변 URL(후속) |

원칙: 크고 불변인 것은 정적 URL 로, 작고 가변인 것은 API JSON 으로, 초고빈도(위치)는 저장하지 않는다.

## 2. 타일 맵 스키마

- 좌표는 **픽셀 기준으로 저작**하고 월드(0~100)는 변환으로 얻는다(HLD §2). 1536×1024 원화에서 1 world unit = 15.36 px 이며 정수가 아니므로, 타일·셀 경계를 월드 단위로 저작하지 않는다.
- 격자는 둘이다. 타일은 **픽셀 격자**(64 px, 24×16, 그림 단위), 통행은 **월드 격자**(정확히 100×100 셀, 셀 = 1 world unit = 15.36×10.24 px, 규칙 단위 — MV-D01 확정). 둘은 정렬되지 않고 정렬할 필요도 없다. 48×32 길 비용 격자는 폐기하고 비용을 통행 셀에 둔다. 충돌·통행은 통행 셀 해상도로만 저작한다.
- 포맷은 Tiled JSON(TMJ)의 부분집합을 따른다: `width·height·tilewidth·tileheight`, `layers[{type:"tilelayer", name, data:[gid…]}]`, `tilesets[{firstgid, image, columns, tilecount}]`. `gid 0` 은 빈 칸, 상위 3비트는 뒤집기 플래그. 레이어는 `terrain`(바닥) · `terrain-detail`(풀·꽃) · `roads` 세 개로 시작한다. 건물·나무·모닥불은 타일이 아니라 **오브젝트**(발밑 앵커, `zIndex = y`)다 — 지금 `VillageScenery` 의 방식과 같다.
- 타일셋은 PNG 아틀라스 한 장(2의 거듭제곱 변, ≤ 4096, 타일 사이 1 px extrusion) + 같은 이름의 JSON. 배율 사본은 `@2x` 하나만 만들고 1x 는 축소해 쓴다(기기 밀도별 사본은 측정 뒤 결정).
- 통행 데이터는 지금부터 NavArtifact 와 같은 모양으로 둔다: `walkable` bitset(행 우선, 10,000 비트 = 1,250 B), `traversalCost` uint8(×10, 10,000 B), `entrances`, `spawns`. 지금 클라이언트가 폴리곤·footprint 에서 매번 계산하는 것을 빌드 때 한 번 계산해 파일로 둔다. Movement 가 생기면 같은 파일을 서버가 만들고 앱은 받기만 한다.
- `mapVersion` 은 지형·타일셋·통행 파일 중 하나라도 바뀌면 올린다(정수, 단조). 파일 이름에는 내용 해시가 들어간다.

```json
{ "mapId": "home", "mapVersion": 12, "coordinateVersion": 1,
  "imageWidth": 1536, "imageHeight": 1024,
  "tiles": { "size": 64, "columns": 24, "rows": 16, "tileset": "tileset.3f9a1c.png" },
  "nav": { "columns": 100, "rows": 100, "file": "nav.8b2e77.bin" },
  "layers": ["terrain", "terrain-detail", "roads"], "objectsCatalog": "objects.1d4c90.json" }
```

## 3. manifest 와 URL·캐시 계약

- `GET /static/maps/{mapId}/manifest.json` — 작고 자주 확인하는 파일. `Cache-Control: public, max-age=60` + `ETag`. 내용: `mapVersion`, 파일 목록과 각 파일의 SHA-256, 바이트 수, 호환 앱 최소 버전.
- 큰 파일은 전부 **내용 해시가 들어간 불변 URL** — `/static/maps/home/v12/tileset.3f9a1c.png`. `Cache-Control: public, max-age=31536000, immutable`. 같은 URL 의 내용을 바꾸지 않으므로 purge 가 필요 없고, 웹서버 직결이든 CDN 경유든 앱 코드가 같다.
- 응답 헤더는 **origin(정적 서버)이 결정**한다. Business API 를 거치지 않는다(전역 `no-store` 필터와 충돌). 섬 에셋은 사용자 데이터가 아니므로 서명 URL·인증이 없다.
- 앱은 manifest 의 해시와 디스크 캐시를 비교해 바뀐 파일만 받고, 받은 파일의 해시를 다시 검증한다(PRD MV-16). 검증 실패 파일은 버린다.

## 4. 정적 서빙 위치 — MV-D09 확정: Nginx 직접 서빙(담당 조재영)

| 단계 | dev(GCP, 호스트 Nginx 허용목록) | prod(AWS, Cloudflare 프록시 → nginx 컨테이너) |
| --- | --- | --- |
| 10/9 | `location ^~ /static/` 추가(`expires 1y; add_header Cache-Control "public, immutable"; gzip off`), 파일은 VM 디스크 | prod nginx.conf 는 인프라 레포 — 같은 location 추가 요청. Cloudflare Cache Rule 로 `/static/*` 는 origin 헤더 준수 |
| 측정 뒤 | 월 egress·원본 p95·해외 비율로 판단 | 버킷(GCS/S3)+CDN 신설은 그때. URL·헤더가 같으므로 앱 변경 없음 |

업로드는 빌드 파이프라인(기획 작업실 `export-village-world` 류)이 해시 파일을 만들고, 배포 스크립트가 `v{mapVersion}/` 디렉터리에 복사한 뒤 manifest 를 마지막에 바꾼다(manifest 가 가리키기 전까지 새 파일은 보이지 않는다).

## 5. 앱 로딩 순서와 캐시

```text
/screens/home ─┐
                ├─ manifest(mapId, mapVersion) ─ 해시 비교 ─ tileset + nav + objects ─┐
layoutRevision ─┘                                                                      ├─ 원자 교체 ─ 렌더
                                              bundled fallback(설치 시 포함 1벌) ───────┘
```

- 의존 순서: manifest → 타일셋·통행·오브젝트 카탈로그(병렬) → 배치(layoutRevision) → 렌더. 배치가 먼저 와도 타일셋 없이 그리지 않는다. 캐릭터·UI·폰트는 독립 경로.
- 원자 교체: 새 `mapVersion` 디렉터리의 파일이 전부 검증되기 전에는 이전 버전(없으면 번들)으로 그린다. 준비 완료 표식 파일을 마지막에 쓴다. HLD §2 의 맵 전환 원칙과 같다.
- 실패 분기: 오프라인·부분 수신·해시 불일치·디스크 부족·배경 전환 → 이전 버전 유지 + 지수 백오프 재시도. 빈 섬·깨진 타일·영구 스피너는 수용 기준 위반(T16).
- 캐시 3층: 메모리(디코드된 텍스처, 아틀라스 1장) / 디스크(해시 이름 파일, 버전 디렉터리) / 번들(설치 시 1벌). 디스크 캐시는 최근 2개 `mapVersion` 만 남긴다.
- 측정: 콜드 스타트(설치 직후 첫 섬까지), 웜 스타트, 캐시 적중률, 세션당 다운로드 바이트, 실패율.

## 6. `layoutRevision` — 지금과 다음

- **지금(결정 2026-10-07, 조재영):** 서버에 배치 정본을 **바로** 만든다 — `island_layouts(island_id PK, layout_revision bigint, layout jsonb, updated_at)`. `layout` 은 `{ "buildings": [ { "id": "hall", "cell": { "x": 71, "y": 31 }, "anchor": "bottom-center", "footprint": [ [x, y], ... ] } ], "mapId": "home", "mapVersion": 12 }` 처럼 **좌표를 JSON 으로 저장**한다. `/screens/home` 에 `layoutRevision` 과 `layout` 을 노출하고, 완공·철거·이동이 `layout_revision` 을 올린다. 서버 변경이 앱보다 늦으면 그 사이에만 앱 로컬 카탈로그로 그린다(임시).
- **다음(섬 꾸미기 피처 4):** 같은 `island_layouts.layout` 을 방장이 편집하는 API(건물 이동·장식 배치)를 붙인다. `layoutRevision` 은 섬 단위 단조 정수이며, Movement 는 이 값으로 NavArtifact 를 컴파일한다.
- 전파: Data 는 `island.updated` 에 `layoutRevision` 을 싣는다. realtime 이 앱 쪽 `events` 구독을 열기 전까지 앱은 홈 재진입·포그라운드 복귀·건설 카드 완료 콜백에서 `/screens/home` 을 다시 읽는다. 감소하는 revision 은 버리고, 공백은 전체 재조회로 수렴한다(PRD data-flow §3 과 같은 규칙).

## 7. 타일 섬 전환(10/9) 과의 대응

| 로드맵 항목 | 이 문서 | 비고 |
| --- | --- | --- |
| ① 좌표 계약 | §2 첫 줄, MV-D01 | 확정: 범위 [0,100]² + 통행 100×100 셀. 96×64 → 100×100 재생성 |
| ② 타일 맵 스키마 | §2 | Tiled 부분집합 + NavArtifact 모양의 통행 파일 |
| ③ 1차 에셋 다운로드 | §3·§4·§5 | 10/9 는 인프라 없이 로컬에서 동작: 로컬 정적 서버(또는 번들)에서 manifest·타일셋을 같은 URL 규칙으로 받고 캐시한다. Nginx 반영은 그 뒤 |
| ④ 배치 시스템 렌더러 | §2 오브젝트, §6 지금 | 타일 레이어 + 오브젝트 앵커, 매 프레임 React 재레이아웃 금지(PRD 비기능 「맵 표시」) |
| ⑤ 로컬 이동 연결 | §2 통행 파일 | 기존 A* 를 bitset 통행 파일에 붙인다 |
| ⑥ 집중섬 배경 | 이번 범위 밖 | MV-D08 확정: 지금은 앱 버그 수정으로 분리, 후속에 같은 스키마로 전환 |

## 8. 열린 결정

- 업로드 주체·스크립트(§4). 10/9 는 인프라 없이 로컬에서 전부 동작하는 것이 목표라 Nginx location 은 그 뒤에 넣는다.
- 타일셋 배율 사본(@2x 하나 vs 밀도별)과 WebP 채택 — 실기기 메모리·디코드 측정 뒤.
- `island_layouts` 의 jsonb 스키마 버전 관리(`layout.schemaVersion`)와 섬 꾸미기(피처 4)에서의 편집 API.
- realtime `events` 토픽의 앱 개방 여부 — 열지 않으면 재조회가 정본 경로로 남는다.
