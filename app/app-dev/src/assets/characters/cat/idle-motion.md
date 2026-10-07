# 고양이 대기 모션 에셋

GROMO-1813에서 추가한 하품·기지개·그루밍 에셋이다.

- 생성 방식: 내장 `image_gen` 도구. CLI/API 대체 경로와 이미지 편집 스크립트는 사용하지 않았다.
- 최종 파일: `{black,ginger,cream,gray,white,calico}/idle/idle-atlas.png`.
- 모든 파일: 1448 × 1086 RGBA PNG, 실제 투명 알파. 6색 × 12프레임 = 72프레임.
- 참고 원본: 각 색상의 `blink/blink-frame-0.png`.
- 논리 순서: 하품 0–3, 기지개 4–7, 그루밍 8–11. 프레임마다 중립·준비·본동작·마무리 자세를 사용한다.

## 렌더링과 재생성

생성 도구가 정규 격자 간격을 정확히 지키지 않으므로 균등 4 × 3 자르기를 사용하면 발이 잘린다. `src/constants/cat-idle-atlases.ts`의 프레임별 `rect`로 실제 고양이 영역을 잘라낸다.

`rect`는 원본 PNG의 픽셀 좌표다. 알파 ≥ 128인 4방향 연결 영역 중 10,000픽셀을 넘는 고양이 12개를 찾고, 각 경계에 가능한 범위에서 2px 여백을 더했다. `scale`은 잘라낸 영역의 표시 너비를 캐릭터의 기존 논리 크기로 나눈 값이며 `0.81 × rect.width / 362`다. 표시 높이는 원본 `rect`의 종횡비를 보존한다.

`footAnchor.y`는 잘라낸 영역 안에서 불투명 발바닥 다음 픽셀 위치다. `footAnchor.x`는 하단 6%의 불투명 발 픽셀 중심을 측정한 다음 기존 색상별 blink의 발 중심과 논리 중심(0.5)의 차이를 보정한 값이다. 따라서 표시상의 물리적 발 중심 자체와는 다르다. 기존 blink 발 중심 x는 black=0.56521, ginger=0.56658, cream=0.57351, gray=0.57853, white=0.56856, calico=0.56837이다.

이미지를 다시 생성하면 크기·프레임 경계·발 기준점도 반드시 다시 측정해야 한다. 외곽 수염 일부와 ginger/cream/gray의 마지막 행 발바닥 말단은 PNG 경계에 붙어 있다. 잘라내기 메타데이터는 추가 손실을 막지만, 생성 시 경계 밖으로 나간 몇 픽셀은 복원하지 않는다.

## 최종 생성 파일

도구 출력 디렉터리의 선택 결과는 아래와 같다. 실제 앱은 위 저장소 경로의 복사본을 사용한다.

- black: `exec-3f37bed7-9965-4688-bb27-0d3544acac33.png`
- ginger: `exec-49b26f15-b3b9-4f00-ad85-32460340231e.png`
- cream: `exec-aa9de476-4280-4552-a4cc-09d217d3fa43.png`
- gray: `exec-3085bd89-3ba3-4c9c-b7f5-6cbfb565defd.png`
- white: `exec-d64c8eaf-1562-4cd9-9b71-7380e448b617.png`
- calico: `exec-42898b9b-a26b-4524-9696-02f808bc6d3b.png`

## 프롬프트 1: 검은 고양이 동작 원본

참고 이미지 1은 black의 기존 blink 0번 프레임이다.

```text
Use case: stylized-concept.
Asset type: production 2D mobile game character sprite atlas.
Input image 1 is the CHARACTER IDENTITY AND DRAWING STYLE REFERENCE, not a canvas to preserve.
Create one transparent PNG sprite sheet of exactly 12 full-body drawings of this same cat, in a precise uniform 4-column by 3-row grid. Landscape canvas 2048x1536, square 512x512 cells, no spacing or margins BETWEEN cells. Each cat entirely inside its own cell, feet centered at local x256,y464. Same cat scale as reference, same camera looking slightly from front, same thick warm dark brown outline, textured paper watercolor fill, body proportions, fur pattern, tail on viewer-left. Entire cat including ears and tail visible with generous clear margin. Actual transparent alpha background, no white backing, no checkerboard artwork.
Four poses across each row form an animation with meaningful anatomy changes:
Row 1 YAWN: column1 calm standing neutral with open eyes and mouth shut; column2 sleepy eyelids and tiny opening mouth, head starting to tilt back; column3 unmistakably big open-mouth yawn with closed eyes, little pink tongue and head tilted back; column4 mouth closing, eyelids reopening, returning to neutral.
Row 2 STRETCH: column1 calm standing neutral; column2 front paws reach forward and shoulders start lowering; column3 unmistakable cat bow stretch with front paws extended forward, head and shoulders low, hindquarters raised, tail curling; column4 rises halfway back to calm standing.
Row 3 GROOM: column1 calm standing neutral; column2 lifts one front paw to the mouth; column3 unmistakably licks lifted front paw with tiny tongue, eyes relaxed; column4 wipes cheek with lifted paw, about to lower it.
The 12 cells are frames, not a poster: do not add labels, text, grid lines, decorative marks, motion lines, props, ground, shadows, borders, watermark or extra animals. Keep bottom of grounded paws on y464 in all cells, silhouettes never touch cell edges. Preserve the exact identity and color of the reference cat throughout.
```

## 프롬프트 2: 다른 5색의 무늬와 색상

참고 이미지 1은 검은 고양이의 생성된 동작 atlas, 이미지 2는 해당 색상의 기존 blink 0번 프레임이다. 아래 프롬프트를 ginger·cream·gray·white·calico 각각에 사용했다.

```text
Use case: identity-preserve. Asset type: production mobile 2D character sprite atlas.
Image 1 is the sprite atlas EDIT TARGET: preserve the exact 4 columns x 3 rows, every cell pose, scale, location, silhouette, feet baseline and animation sequence from it.
Image 2 is the new cat CHARACTER IDENTITY/COLOR REFERENCE.
Repaint every one of the 12 cats in image 1 to exactly match the cat identity in image 2: its fur base color, stripes or patches, eyes including eye whites or absence of them, ear interior color, muzzle and chest and paws. Keep the expressive yawn mouth, stretching anatomy, lifted grooming paw, and tongues in the corresponding cells from image 1. Retain textured watercolor-paper fill with dark warm-brown outlines. Keep image 1 layout and animation poses unchanged. Output a landscape 4:3 PNG image with a genuinely transparent alpha background; no opaque backing or checkerboard artwork.
Row 1 yawn neutral/preparation/open yawn/settle; row2 stretch neutral/lower shoulders/full cat bow/stand halfway; row3 grooming neutral/paw raised/lick paw/wipe face. Exactly 12 cats one per uniform square cell. No labels, text, grid lines, borders, props, ground shadows or extra animals. All body parts fully inside each cell.
```

## 프롬프트 3: 다른 5색의 눈 형태 교정

참고 이미지 1은 색상별 동작 atlas, 이미지 2는 해당 색상의 기존 blink 0번 프레임이다. 검은 고양이의 흰 눈자위가 다른 색상에 전달된 부분만 교정했다.

```text
Use case: precise-object-edit. Input image 1 is an existing production 12-frame sprite atlas EDIT TARGET. Image2 is the character identity REFERENCE.
Edit ONLY the eyes in the first image to restore the exact eye design from image2. This non-black cat has two small SOLID DARK BROWN OVAL EYES with one tiny white shine dot each. There are NO LARGE WHITE EYEBALLS and NO WHITE SCLERA; replace the white eyeball regions with the surrounding fur color/texture and place the small dark oval eyes from image2 centered there. Sleeping, yawning and grooming CLOSED LINE EYES stay unchanged. Half-open sleepy eyes should be dark half-oval eyes with NO WHITE SCLERA.
Keep every cat's body, proportions, pose, position, colors, fur markings, dark outlines, mouth, tongue, paws, whiskers and tail EXACTLY unchanged. Preserve exact canvas size, 4x3 frame positions and actual transparent alpha background. Do not shift, enlarge or shrink any sprite. No added shapes, decorations, text, grid lines, shadows or props. Only correct the visible open eyes to match image2.
```
