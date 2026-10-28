# 피그마에 올리기

## 원리

`layout.cjs`가 묶음 하나를 SVG 하나로 그린다. 캡처는 SVG 안에 JPEG로 품는다(`EMBED=1`). 이 SVG를 Figma MCP의 `upload_assets`로 올리면 편집 가능한 레이어로 들어온다.

이렇게 하는 이유: 화면 200개의 제목·글·좌표를 `use_figma` 코드에 타이핑하면 토큰이 수만 개 들고 오타가 섞인다. 파일로 올리면 타이핑할 것이 주소의 짧은 id뿐이다.

2026-10-05에 확인한 사실:
- SVG의 `id` 속성이 피그마 레이어 이름이 된다. 그래서 `img:<화면 id>`, `shot:<화면 id>`, `arrow:<출발>><도착>`, `hot:…`, `cap:<화면 id>#<줄>` 같은 이름으로 나중에 찾을 수 있다.
- `<image href="data:image/jpeg;base64,…">`는 이미지 채움 사각형(RECTANGLE)이 된다. 모서리는 올린 뒤 둥글게 한다.
- `<text>`는 편집 가능한 글자가 된다. `font-family="Noto Sans KR"`가 그대로 적용되고, `font-weight="700"`은 Bold가 된다(500은 Regular로 떨어진다).
- 자산 하나에 10MB 제한. JPEG 품질 76으로 품었을 때 가장 큰 묶음(게시판, 화면 24개)이 9.1MB였다. 화면이 늘면 넘는다.
- 디자인 파일(`/design/`)에는 Connector가 없다. 화살표는 일반 선이라 화면을 옮기면 따라오지 않는다.
- 올리는 주소는 한 번만 쓸 수 있고 10분 뒤 만료된다. SVG는 `curl -F "file=@…;type=image/svg+xml"`(멀티파트)로, 그림 한 장은 `curl -H "Content-Type: image/jpeg" --data-binary @…`로 올렸고 둘 다 됐다.

## 순서

```sh
SK=<레포>/.claude/skills/gromo-screen-flow/scripts; WF=<작업 폴더>
$SK/make-jpg.sh 76                 # shots/final/*.png → shots/jpg/*.jpg (이미 만든 것은 건너뜀)
node $SK/layout.cjs                # svg/ — 미리보기용(캡처를 파일 경로로 건다)
node $SK/preview.cjs $WF/svg/07-board.svg $WF/preview/board.png 0.2
EMBED=1 node $SK/layout.cjs        # svg-embed/ — 업로드용
ls -la $WF/svg-embed               # 전부 10MB 아래인지
```

10MB를 넘는 묶음이 있으면 품질을 낮춰 전부 다시 만든다: `FORCE=1 $SK/make-jpg.sh 68` 뒤에 `EMBED=1 node $SK/layout.cjs`.

1. **미리보기를 먼저 본다.** 화살표가 화면을 가로지르는 곳, 글이 겹치는 곳, 빈 틀을 확인한다. 피그마에 올린 뒤 고치면 다시 올려야 한다.
2. **대상 페이지 확인.** `use_figma`로 `figma.root.children`의 이름·id를 읽는다(읽기 전용). `get_metadata`의 페이지 목록은 일부만 보여 준 적이 있다. 지난 실행의 페이지는 "화면 워크플로우" `941:2`.
3. **기존 프레임 처리.** 그 페이지에 지난 실행의 프레임이 있으면(`run.json`의 `figma.frames`) 새로 올릴 묶음의 것은 지워야 한다. 오스카가 손으로 고치거나 댓글을 단 것이 있을 수 있으니 물어본 뒤 지운다.
4. **올리기.** `upload_assets`를 `count` = 올릴 SVG 개수, `currentPageId` = 페이지 id로 부른다(`nodeIds` 없이). 받은 주소들에서 `/upload/<uuid>/submit`의 uuid를 순서대로 넘긴다:
   ```sh
   $SK/upload-svgs.sh 941:2 <uuid1> <uuid2> ...          # 전부
   ONLY=07-board $SK/upload-svgs.sh 941:2 <uuid>         # 한 묶음만
   ```
   파일 이름순(00-index, 01-…)으로 짝지어지고, 각 파일이 어느 프레임으로 들어갔는지 출력한다.
5. **정리 스크립트.** 새 프레임은 아무 데나 놓이고 이름이 파일명이다. 아래 스크립트가 페이지의 묶음 프레임 전체를 번호순으로 다시 줄 맞추고, 새 프레임의 이름을 바꾸고, 캡처 모서리를 둥글게 한다. 한 묶음만 올렸을 때도 그대로 쓴다.
6. **확인.** 묶음 하나와 확대한 한 구역을 캡처해 본다(아래 "구역 캡처").
7. `run.json`의 프레임 id를 새 값으로 고친다.

`use_figma`를 쓰기 전에 Figma MCP의 `figma-use` 안내(스킬 또는 `skill://figma/figma-use/SKILL.md`)를 읽는다. 그 안내는 화면을 편집 가능한 레이어로 다시 만들라고 하지만, 이 작업은 흐름도이고 캡처를 그림으로 넣는 것이 오스카가 정한 방식이다. 흐름도의 글·화살표·테두리는 편집 가능한 레이어로 들어간다.

## 정리 스크립트 (use_figma)

`names`는 `WF/manifest.json`의 `file`→`name`을 옮겨 적는다(안내판은 `'00-index': '00 읽는 법 · 묶음 목록'`).

```js
const page = await figma.getNodeByIdAsync('941:2');          // 대상 페이지 id
await figma.setCurrentPageAsync(page);
const names = { '00-index': '00 읽는 법 · 묶음 목록', '01-onboarding': '01 온보딩 — 앱 시작부터 첫 섬까지' /* … */ };
// 새로 올린 프레임(이름이 '07-board' 꼴)과 이미 정리된 프레임(이름이 '07 게시판 …' 꼴)을 함께 번호순으로
const frames = page.children.filter(c => /^\d\d(-[a-z]+$| )/.test(c.name)).sort((a, b) => a.name.slice(0, 2).localeCompare(b.name.slice(0, 2)));
const GAP = 500, LIMIT = 24500;                               // 한 줄에 24,500px 까지 놓고 넘치면 다음 줄
let x = 0, y = 0, rowH = 0, imgs = 0;
const out = [];
for (const f of frames) {
  if (x > 0 && x + f.width > LIMIT) { x = 0; y += rowH + GAP; rowH = 0; }
  f.x = x; f.y = y; x += f.width + GAP; rowH = Math.max(rowH, f.height);
  for (const n of f.findAllWithCriteria({ types: ['RECTANGLE'] })) if (n.name.startsWith('img:')) { n.cornerRadius = 28; imgs++; }
  if (names[f.name]) f.name = names[f.name];
  out.push({ id: f.id, name: f.name, x: f.x, y: f.y });
}
return { frameCount: frames.length, imgs, frames: out };
```

돌아온 프레임 수가 14(안내판 + 묶음 13)인지, 같은 번호가 둘이 아닌지(옛 프레임을 안 지운 것), `imgs`가 캡처 개수와 맞는지 본다.

## 구역 캡처로 확인하기

프레임 전체 캡처는 글자가 안 보일 만큼 작다. 임시 slice를 만들어 한 구역만 찍고 바로 지운다.

```js
const page = await figma.getNodeByIdAsync('941:2');
await figma.setCurrentPageAsync(page);
const frame = await figma.getNodeByIdAsync('<묶음 프레임 id>');
const s = figma.createSlice();
page.appendChild(s);
s.x = frame.x; s.y = frame.y + 60; s.resize(2500, 2350);
await s.screenshot({ scale: 0.62, contentsOnly: false });
s.remove();
return { ok: true };
```

## 한 장 교체

화면 한 장만 새 캡처로 바꿀 때는 그림을 다시 올리지 않는다.

1. **새 캡처 준비.** `shots/final/<화면 id>.png`에 넣고(옛 것은 따로 보관) JPEG로 만든다: `sips -s format jpeg -s formatOptions 82 in.png --out up.jpg`. 시뮬레이터 캡처(1206×2622)와 웹 캡처(804×1748)는 비율이 같아 그대로 맞는다.
2. **넣을 노드 찾기.** `use_figma`로 그 묶음 프레임(`run.json`)의 자식 중 이름이 `img:<화면 id>`인 사각형을 찾는다. 처음 올릴 때 캡처가 없던 화면은 `img:`가 없고 `shot:<화면 id>` 벡터에 그림을 넣는다(지난번에 시뮬레이터로 채운 초대 공유 창과 앱 선택 창이 그렇다). 캡처 없음 글자(`noshot-title:<id>`, `noshot:<id>#*`)가 남아 있으면 지운다.
3. **올리기.** `upload_assets`를 `nodeIds: [그 id]`, `scaleMode: "FILL"`로 부르고 받은 주소에 올린다:
   ```sh
   curl -sS -X POST -H "Content-Type: image/jpeg" --data-binary @up.jpg "<submitUrl>"
   ```
4. **화면 아래 글 고치기.** `cap:<화면 id>#<줄>` 글자 중 "※"로 시작하는 줄을 새 문구로 바꾸고, 이어지는 같은 색 줄을 지우고, 그 아래 줄들을 지운 줄 수 × 19px 만큼 올린다. "※" 줄이 없으면 맨 아래에 한 줄 추가한다. 글자를 바꾸기 전에 그 글자의 글꼴을 `loadFontAsync`로 불러야 한다.
5. **보고 파일 고치기.** `shots/report-*.json`의 그 화면을 고쳐, 다음에 그림을 다시 만들 때도 같은 내용이 나오게 한다. 시뮬레이터로 찍었으면 `"status": "ok", "via": "simulator", "date": "YYYY-MM-DD"`.
6. 안내판(00)의 "캡처가 없는 화면 N개" 숫자가 달라졌으면 그 글자도 고친다.
