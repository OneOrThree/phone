import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import {
  BlendMode,
  Canvas,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  Skia,
  type SkImage,
  type SkPicture,
} from '@shopify/react-native-skia';
import type { CatalogEntry, CatalogTable, CatFit } from '@/services/customizationCatalog';
import { useCustomizationCatalog } from '@/services/customizationCatalog';
import type { CatFitView } from '@/services/customizationCatalog';
import {
  catFitArtBox,
  catFitFrameId,
  headLayer,
  neckLayer,
  neckRigFrame,
  type FitOp,
  type FitPose,
} from './catFit';

/** 겹치는 순서 — 신발이 맨 아래, 머리가 맨 위. */
export const OUTFIT_ORDER = ['shoes', 'neck', 'head'] as const;
export type OutfitSlot = (typeof OUTFIT_ORDER)[number];
export type Outfit = Partial<Record<OutfitSlot, string | null | undefined>>;
/**
 * 고양이 그림의 털색과 자세 — 애니메이션은 CatSprite 가 그리는 자세·프레임, 정지 그림은 still(idle·loaf·avatar).
 * size 는 고양이 상자 한 변(px) — 없으면 부모 상자를 재서 쓴다(GROMO-2382).
 */
export type OutfitPose = FitPose & { size?: number };
/** cat-fit 합본의 그리기 순서(fitting.js drawCat) — 목 → 머리. */
const FIT_ORDER: readonly OutfitSlot[] = ['neck', 'head'];

/**
 * 꾸미기 PNG 가 그려지는 고양이 원본 캔버스 한 변(px). 카탈로그 `width/height` 는 PNG 실측 픽셀이고, 표시 크기는
 * `width / CAT_CANVAS_PX × 고양이 상자`다. 실측(GROMO-2311): 2303 `duck.png` 는 1254², 앱에 실린 고양이 스프라이트는 512²
 * 로 줄인 것이다. duck 의 불투명 영역이 가로 633px(= 캔버스의 50%)로 고양이 머리(512 기준 ≈264px, 52%)와 맞아
 * 원본 캔버스를 1254 로 본다 — 512 로 두면 모자가 고양이의 245% 가 된다.
 */
export const CAT_CANVAS_PX = 1254;

/** 고양이 상자 안의 그림 사각형(상자 대비 %) — anchor 는 그림 **중심**이 놓일 상자 안 0~1 위치. 상자 크기를 몰라도 된다. */
export function outfitRect(entry: CatalogEntry) {
  const w = entry.width / CAT_CANVAS_PX;
  const h = entry.height / CAT_CANVAS_PX;
  const pct = (n: number) => `${Math.round(n * 1e4) / 100}%` as `${number}%`;
  return {
    width: pct(w),
    height: pct(h),
    left: pct(entry.anchorX - w / 2),
    top: pct(entry.anchorY - h / 2),
  };
}

/** 상태에 실린 머리·목·신발 — 키 없음(옛 서버·미장착)과 null(해제)은 모두 «미장착» 이다. */
export const outfitOf = (state: { equipped: Outfit }): Outfit => ({
  head: state.equipped.head ?? null,
  neck: state.equipped.neck ?? null,
  shoes: state.equipped.shoes ?? null,
});

/** 장착 중인 항목을 shoes → neck → head 순으로 — 카탈로그에 없는 id 는 건너뛴다. */
export function outfitLayers(outfit: Outfit, catalog: CatalogTable): CatalogEntry[] {
  return OUTFIT_ORDER.flatMap((slot) => {
    const id = outfit[slot];
    const entry = id ? catalog[id] : undefined;
    return entry ? [entry] : [];
  });
}

/**
 * 카탈로그 그림으로 고양이 위에 머리·목·신발을 겹친다(GROMO-2311). 부모는 고양이와 같은 정사각 상자(position 이 있는 View)여야 한다.
 * 그림을 못 읽으면 아무것도 그리지 않는다(Image 실패는 조용히 비어 보인다).
 *
 * - 정적 오버레이(오리 모자 등)는 정지 그림(pose 없음·still) 위에만 그린다 — 애니메이션 프레임 좌표가 없다.
 * - cat-fit 항목(GROMO-2382)은 pose 가 자료에 있는 털색·자세·프레임일 때만 그린다(6색 × walk·focus·reel·blink·read +
 *   idle·loaf·avatar). 그 밖의 자세(던지기·기지개 등)는 그동안만 숨긴다 — 다른 자세 좌표를 빌려 쓰지 않는다.
 */
export function CatOutfitLayers({ outfit, pose }: { outfit: Outfit; pose?: OutfitPose }) {
  const catalog = useCustomizationCatalog();
  const [measured, setMeasured] = useState(0);
  const layers = outfitLayers(outfit, catalog);
  const statics = !pose || pose.still ? layers.filter((entry) => !entry.catFit) : [];
  // 검증 밖 프레임에서도 레이어는 마운트해 둬 그림·rig 를 다시 받지 않는다(그 프레임만 비운다). 자료에 없는 털색은 받지도 않는다
  const fits = pose
    ? FIT_ORDER.flatMap((slot) =>
        layers.filter((e) => e.catFit?.colors.includes(pose.color) && e.slot === slot),
      )
    : [];
  const size = pose?.size ?? measured;
  if (statics.length === 0 && fits.length === 0) return null;
  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={StyleSheet.absoluteFill}
      onLayout={pose?.size ? undefined : (e) => setMeasured(e.nativeEvent.layout.width)}
    >
      {statics.map((entry) => (
        <Image
          key={entry.productId}
          testID={`outfit-${entry.slot}`}
          accessible={false}
          source={{ uri: entry.imageUrl }}
          style={[styles.layer, outfitRect(entry)]}
        />
      ))}
      {pose && fits.length > 0 && size > 0 && (
        <Canvas testID="outfit-fit" style={[styles.fit, { width: size, height: size }]}>
          <Group transform={[{ scale: size / 512 }]}>
            {fits.map((entry) => (
              <CatFitLayer
                key={entry.productId}
                entry={entry}
                color={pose.color}
                frameId={catFitFrameId(entry.catFit!, pose)}
              />
            ))}
          </Group>
        </Canvas>
      )}
    </View>
  );
}

/**
 * rig JSON·PNG(내용 해시 이름이라 바뀌지 않는다)를 앱 실행 중 한 번만 받아 레이어끼리 나눠 쓴다 — 집중을 시작해 고양이가 다시
 * 마운트돼도 소품이 늦게 나타나지 않는다. 실패는 기억하지 않는다(다음 마운트에 다시 받는다).
 * ponytail: 맵은 인코딩된 PNG(아이템당 300~760KB, MakeImageFromEncoded 는 그릴 때 해독)와 rig JSON 만 들고 계속 둔다 —
 * 입어 본 아이템 수만큼 늘어나니 많아지면 LRU 로 줄인다.
 */
const loaded = new Map<string, Promise<unknown>>();
function useShared<T>(url: string | null, load: (url: string) => Promise<T>): T | null {
  const [value, setValue] = useState<{ url: string; data: T } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let pending = loaded.get(url) as Promise<T> | undefined;
    if (!pending) {
      pending = load(url);
      loaded.set(url, pending);
      pending.catch(() => loaded.delete(url));
    }
    pending.then(
      (data) => live && setValue({ url, data }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [url, load]);
  return value?.url === url ? value.data : null;
}
const loadRig = (url: string): Promise<unknown> =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`rig ${res.status}`);
    return res.json();
  });
const loadImage = (url: string): Promise<SkImage> =>
  Skia.Data.fromURI(url).then((data) => {
    const image = Skia.Image.MakeImageFromEncoded(data);
    if (!image) throw new Error(`image ${url}`);
    return image;
  });

const rect = ([x, y, w, h]: readonly number[]) => Skia.XYWHRect(x, y, w, h);

/** 한 아이템·한 프레임을 512² Picture 로 기록한다. rig 가 그 프레임을 모르면 null. */
export function recordFit(
  fit: CatFit,
  color: string,
  frameId: string,
  item: SkImage,
  band: SkImage | null,
  rig: unknown,
): SkPicture | null {
  const recorder = Skia.PictureRecorder();
  const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, 512, 512));
  const paint = Skia.Paint();
  const draw = (op: FitOp) => {
    const image = op.img === 'band' ? band : item;
    if (!image) return;
    if (op.at) {
      canvas.save();
      canvas.translate(op.at.x, op.at.y);
      canvas.rotate(op.at.deg, 0, 0);
    }
    // 원본(1254²)을 10~20배 줄여 그리므로 선형 + 밉맵 샘플링 — 기본(최근접)은 계단·반짝임이 생긴다
    canvas.drawImageRectOptions(
      image,
      rect(op.src),
      rect(op.dst),
      FilterMode.Linear,
      MipmapMode.Linear,
      paint,
    );
    if (op.at) canvas.restore();
  };
  // 프로필 그림처럼 고양이를 키워 그린 정지 그림은 리그 좌표계를 그림에 맞춰 한 번 옮기고 키운다
  const view = (v: CatFitView | undefined) => {
    if (!v) return;
    canvas.translate(v.x, v.y);
    canvas.scale(v.scale, v.scale);
  };
  let drawn = false;
  if (fit.head) {
    const head = headLayer(fit, color, frameId);
    if (head) {
      view(head.view);
      const { x, y, deg, rx, ry } = head.shadow;
      const shadow = Skia.Paint();
      shadow.setColor(Skia.Color('rgba(51,27,14,0.18)'));
      canvas.save();
      canvas.translate(x, y);
      canvas.rotate(deg, 0, 0);
      canvas.drawOval(Skia.XYWHRect(-rx, -ry, rx * 2, ry * 2), shadow);
      canvas.restore();
      draw(head.op);
      drawn = true;
    }
  } else if (fit.neck) {
    const frame = neckRigFrame(rig, frameId);
    const neck = frame && neckLayer(fit, frame);
    if (neck) {
      view(frame.view);
      // 목 레이어만 따로 쌓아 턱선·앞발 가림 영역을 지운다(고양이 그림은 지우지 않는다)
      canvas.saveLayer();
      neck.ops.forEach(draw);
      const eraser = Skia.Paint();
      eraser.setBlendMode(BlendMode.DstOut);
      for (const polygon of neck.erase) {
        const path = Skia.PathBuilder.Make();
        polygon.forEach(([px, py], i) => (i ? path.lineTo(px, py) : path.moveTo(px, py)));
        path.close();
        canvas.drawPath(path.build(), eraser);
      }
      canvas.restore();
      drawn = true;
    }
  }
  const picture = recorder.finishRecordingAsPicture();
  if (drawn) return picture;
  picture.dispose();
  return null;
}

/**
 * 기록한 프레임을 512² 로 먼저 래스터화한다(합본처럼 512 캔버스에 그린 뒤 줄인다). 1px 행·0.65px 열을 화면 크기에서 바로
 * 그리면 겹친 가장자리 보간이 쌓여 띠가 줄무늬처럼 바랜다.
 */
function rasterFit(picture: SkPicture): SkImage | null {
  const surface = Skia.Surface.Make(512, 512);
  if (surface) {
    surface.getCanvas().drawPicture(picture);
    surface.flush();
  }
  const image = surface?.makeImageSnapshot() ?? null;
  // 스냅샷은 표면과 별개 이미지라 기록·표면은 바로 놓는다
  picture.dispose();
  surface?.dispose();
  return image;
}

/**
 * 래스터한 프레임을 앱 전체에서 나눠 쓰는 LRU(키 productId|털색|프레임, 꺼낼 때 맨 뒤로). 한 고양이가 머리·목을 다 입으면
 * 걷기6+깜빡임3 = 18장, 집중4+감기4 = 16장이 돈다 — 도는 프레임보다 작으면 동작이 바뀔 때마다 JS 스레드에서 다시 그린다.
 * 같은 키라도 자료(fit)가 바뀌면(카탈로그 재조회) 다시 그린다.
 * ponytail: 최대 48장(512² RGBA ≈ 1MB 씩, 합계 ≈ 48MB)까지 — 남의 고양이를 여럿 입히면(2390) 화면당 장수를 보고 늘리거나 줄인다.
 */
export const FRAME_CACHE = 48;
const frames = new Map<string, { fit: CatFit; image: SkImage | null }>();
export function cachedFrame(key: string, fit: CatFit, make: () => SkImage | null): SkImage | null {
  const hit = frames.get(key);
  frames.delete(key);
  const entry = hit && hit.fit === fit ? hit : { fit, image: make() };
  frames.set(key, entry);
  // 빠진 이미지는 아직 화면에 그려지는 중일 수 있어 dispose 하지 않는다(가비지 수집에 맡긴다)
  if (frames.size > FRAME_CACHE) frames.delete(frames.keys().next().value!);
  return entry.image;
}
const SAMPLING = { filter: FilterMode.Linear, mipmap: MipmapMode.Linear };

function CatFitLayer({
  entry,
  color,
  frameId,
}: {
  entry: CatalogEntry;
  color: string;
  frameId: string | null;
}) {
  const fit = entry.catFit!;
  const commonBand = fit.neck && !fit.neck.band ? fit.neck.commonBand.url : null;
  const item = useShared(entry.imageUrl, loadImage);
  const band = useShared(commonBand, loadImage);
  const rig = useShared(fit.head ? null : (fit.rigUrls[color] ?? null), loadRig);
  if (!frameId || !item || (commonBand && !band) || (!fit.head && !rig)) return null;
  // 프레임마다 한 번만 그린다 — 걷기·집중·낚아올리기 프레임을 돌며 재사용(털색마다 rig·접촉점이 달라 따로 둔다)
  const image = cachedFrame(`${entry.productId}|${color}|${frameId}`, fit, () => {
    const picture = recordFit(fit, color, frameId, item, band, rig);
    return picture && rasterFit(picture);
  });
  return image ? (
    <SkiaImage image={image} x={0} y={0} width={512} height={512} sampling={SAMPLING} />
  ) : null;
}

/**
 * 카탈로그 그림 한 장을 size² 안에 맞춘다(옷장 썸네일·결과창). cat-fit 항목은 시트 전체가 아니라 대표 시점 영역만 잘라
 * 보여 준다(목 앞 장식·머리 알파 크롭). 정적 오버레이는 그림 전체.
 */
export function OutfitItemArt({
  entry,
  size,
  testID,
}: {
  entry: CatalogEntry;
  size: number;
  testID?: string;
}) {
  if (!entry.catFit)
    return (
      <Image
        accessible={false}
        testID={testID}
        source={{ uri: entry.imageUrl }}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
    );
  const [l, t, r, b] = catFitArtBox(entry.catFit);
  const scale = Math.min(size / (r - l), size / (b - t));
  return (
    <View
      accessible={false}
      testID={testID}
      style={[styles.crop, { width: (r - l) * scale, height: (b - t) * scale }]}
    >
      <Image
        source={{ uri: entry.imageUrl }}
        style={[
          styles.layer,
          {
            width: entry.catFit.width * scale,
            height: entry.catFit.height * scale,
            left: -l * scale,
            top: -t * scale,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  fit: { position: 'absolute', left: 0, top: 0 },
  crop: { overflow: 'hidden' },
});
