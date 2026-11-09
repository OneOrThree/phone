import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Group, Vector3 } from "three";
export const LabelLayer = createContext<RefObject<HTMLDivElement | null>>({
  current: null,
});

// 이름표 겹침 정리. 각 라벨은 매 프레임 화면 좌표만 적고, 한 프레임에 한 번(그리기 전
// microtask) 모든 라벨을 함께 배치한다. 크기는 ResizeObserver가 바뀔 때만 알려 준다.
// 내 이름표와 장소 이름은 항상 보이고, 다른 고양이 이름은 내 이름표에 가까운 순서로
// 제자리 → 한 줄 위 순서로 빈 곳을 찾는다. 자리가 없으면 DOM은 두고 보이지만 않게 한다.
type Kind = "self" | "place" | "cat";
type Entry = {
  el: HTMLSpanElement;
  kind: Kind;
  order: number;
  x: number;
  y: number;
  depth: number;
  inView: boolean;
  w: number;
  h: number;
  row: number;
  shown: boolean;
  style: { display: string; visibility: string; transform: string };
};
type Box = { l: number; t: number; r: number; b: number };
type Registry = {
  entries: Set<Entry>;
  byElement: Map<Element, Entry>;
  observer: ResizeObserver | null;
  scheduled: boolean;
};
const GAP = 3;
const registries = new WeakMap<object, Registry>();
let sequence = 0;

function registryFor(layer: object): Registry {
  let registry = registries.get(layer);
  if (registry) return registry;
  const entries = new Set<Entry>(),
    byElement = new Map<Element, Entry>();
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((records) => {
          for (const record of records) {
            const entry = byElement.get(record.target);
            if (!entry) continue;
            const box = record.borderBoxSize?.[0];
            entry.w = box
              ? box.inlineSize
              : (record.target as HTMLElement).offsetWidth;
            entry.h = box
              ? box.blockSize
              : (record.target as HTMLElement).offsetHeight;
          }
        });
  registry = { entries, byElement, observer, scheduled: false };
  registries.set(layer, registry);
  return registry;
}

function write(entry: Entry, key: keyof Entry["style"], value: string) {
  if (entry.style[key] === value) return;
  entry.style[key] = value;
  entry.el.style[key] = value;
}
const overlaps = (a: Box, b: Box, pad: number) =>
  a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;

function layout(registry: Registry) {
  registry.scheduled = false;
  const visible: Entry[] = [];
  for (const entry of registry.entries) {
    if (entry.inView) visible.push(entry);
    else {
      write(entry, "display", "none");
      entry.shown = false;
    }
  }
  const self = visible.find((e) => e.kind === "self");
  const rank = (e: Entry) =>
    e.kind === "self"
      ? -2
      : e.kind === "place"
        ? -1
        : self
          ? Math.hypot(e.x - self.x, e.y - self.y)
          : e.depth * 1e4;
  visible.sort((a, b) => rank(a) - rank(b) || a.order - b.order);
  const placed: Box[] = [];
  for (const entry of visible) {
    write(entry, "display", "");
    const box = (row: number): Box => {
      const top = entry.y - entry.h / 2 - row * (entry.h + GAP);
      return {
        l: entry.x - entry.w / 2,
        t: top,
        r: entry.x + entry.w / 2,
        b: top + entry.h,
      };
    };
    let row = 0;
    if (entry.kind === "cat") {
      // 크기를 아직 모르면 이번 프레임은 숨긴 채 배치만 해 두고 다음 프레임에 고른다.
      if (!entry.w) row = -1;
      else {
        // 지금 보이는 라벨은 맞닿기만 해도 유지하고(새 라벨은 GAP 여유가 필요), 한 줄 위로
        // 올라간 라벨은 여유가 있을 때만 제자리로 내려와 프레임마다 깜빡이지 않게 한다.
        const pad = (r: number) =>
          entry.shown && entry.row === r
            ? 0
            : entry.row === 1 && r === 0
              ? 8
              : GAP;
        row =
          [0, 1].find(
            (r) => !placed.some((b) => overlaps(box(r), b, pad(r))),
          ) ?? -1;
      }
    }
    const show = row >= 0;
    if (show) placed.push(box(row));
    entry.row = Math.max(0, row);
    entry.shown = show;
    write(entry, "visibility", show ? "" : "hidden");
    write(
      entry,
      "transform",
      `translate(-50%, -50%) translate(${entry.x}px,${entry.y - entry.row * (entry.h + GAP)}px)`,
    );
  }
}

// 장면 라벨은 별도 React root 없이 같은 DOM 층에 붙인다.
export function Label({
  position,
  text,
  self = false,
  place = false,
}: {
  position: [number, number, number];
  text: string;
  self?: boolean;
  place?: boolean;
}) {
  const layer = useContext(LabelLayer),
    group = useRef<Group>(null),
    entry = useRef<Entry | null>(null);
  const point = useRef(new Vector3());
  const content = text + (self ? " · 나" : "");
  const latest = useRef(content);
  latest.current = content;
  const { size, camera } = useThree();
  useEffect(() => {
    const el = document.createElement("span");
    el.className = place ? "place-label" : `cat-label${self ? " self" : ""}`;
    el.textContent = latest.current;
    layer.current?.appendChild(el);
    const registry = registryFor(layer);
    const next: Entry = {
      el,
      kind: self ? "self" : place ? "place" : "cat",
      order: sequence++,
      x: 0,
      y: 0,
      depth: 0,
      inView: false,
      w: 0,
      h: 0,
      row: 0,
      shown: false,
      style: { display: "", visibility: "", transform: "" },
    };
    registry.entries.add(next);
    registry.byElement.set(el, next);
    registry.observer?.observe(el);
    entry.current = next;
    return () => {
      registry.observer?.unobserve(el);
      registry.entries.delete(next);
      registry.byElement.delete(el);
      el.remove();
      entry.current = null;
    };
  }, [layer, place, self]);
  useEffect(() => {
    if (entry.current) entry.current.el.textContent = content;
  }, [content]);
  useFrame(() => {
    const current = entry.current;
    if (!group.current || !current) return;
    group.current.getWorldPosition(point.current);
    point.current.project(camera);
    const p = point.current;
    const x = (p.x * 0.5 + 0.5) * size.width;
    const y = (-p.y * 0.5 + 0.5) * size.height;
    const underHeader =
      y < (size.width < 700 ? 210 : 180) &&
      (size.width < 700 || x < 330 || x > size.width - 390);
    current.x = x;
    current.y = y;
    current.depth = p.z;
    current.inView = p.z <= 1 && p.z >= -1 && !underHeader;
    const registry = registryFor(layer);
    if (!registry.scheduled) {
      registry.scheduled = true;
      queueMicrotask(() => layout(registry));
    }
  });
  return <group ref={group} position={position} />;
}
