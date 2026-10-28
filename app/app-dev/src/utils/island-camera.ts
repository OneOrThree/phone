// Camera behavior from preview/motion/island-zoom.html. Coordinates are world pixels.
export type XY = { x: number; y: number };
// Keep native SVG backing surfaces bounded even on wide screens. Camera zoom
// remains a transform; rendering a phone-width world at iPad width wastes pixels.
export const islandBaseScale = (width: number, height: number) =>
  Math.min(width / 1024, height / 1700);
/**
 * 가운데가 x 인 폭 w 의 이름표·말풍선을 보이는 가로 범위 [lo, hi] 기준으로 옮긴 새 가운데.
 * 주인(x)이 화면 안이면 이름표 전체를 화면 안으로, 화면 밖이면 전체를 화면 밖으로 민다 — 가장자리에 반쯤 잘린 이름표를 남기지 않는다.
 */
export const keepLabelInView = (x: number, w: number, lo: number, hi: number) =>
  x < lo
    ? Math.min(x, lo - w / 2)
    : x > hi
      ? Math.max(x, hi + w / 2)
      : Math.max(lo + w / 2, Math.min(hi - w / 2, x));
export class IslandCamera {
  width = 402;
  height = 874;
  center: XY = { x: 1280, y: 768 };
  scale = 402 / 1024;
  get defaultScale() {
    const fit = Math.max(this.minScale, islandBaseScale(this.width, this.height));
    // A short phone viewport should frame the village, with the coasts reached
    // by panning. Keep the rendering base bounded independently of this zoom.
    return this.width > this.height && this.height < 600 ? fit * 1.45 : fit;
  }
  get minScale() {
    return Math.min(this.width / 2560, this.height / 1536) * 0.96;
  }
  get maxScale() {
    return this.defaultScale * 2.4;
  }
  resize(width: number, height: number) {
    const relative = this.scale / this.defaultScale;
    this.width = width;
    this.height = height;
    this.scale = this.limit(this.defaultScale * relative);
    this.clamp();
  }
  limit(scale: number) {
    return Math.max(this.minScale, Math.min(this.maxScale, scale));
  }
  clamp() {
    const x = this.width / (2 * this.scale),
      y = this.height / (2 * this.scale);
    this.center.x = x >= 1280 ? 1280 : Math.max(x - 80, Math.min(2560 - x + 80, this.center.x));
    this.center.y = y >= 768 ? 768 : Math.max(y - 80, Math.min(1536 - y + 80, this.center.y));
  }
  world(p: XY): XY {
    return {
      x: (p.x - this.width / 2) / this.scale + this.center.x,
      y: (p.y - this.height / 2) / this.scale + this.center.y,
    };
  }
  screen(p: XY): XY {
    return {
      x: (p.x - this.center.x) * this.scale + this.width / 2,
      y: (p.y - this.center.y) * this.scale + this.height / 2,
    };
  }
  pan(dx: number, dy: number) {
    this.center.x -= dx / this.scale;
    this.center.y -= dy / this.scale;
    this.clamp();
  }
  zoom(scale: number, at: XY, anchor = this.world(at)) {
    this.scale = this.limit(scale);
    this.center = {
      x: anchor.x - (at.x - this.width / 2) / this.scale,
      y: anchor.y - (at.y - this.height / 2) / this.scale,
    };
    this.clamp();
  }
}
