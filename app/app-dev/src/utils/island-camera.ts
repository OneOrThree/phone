// Camera behavior from preview/motion/island-zoom.html. Coordinates are world pixels.
export type XY = { x: number; y: number };
// Keep native SVG backing surfaces bounded even on wide screens. Camera zoom
// remains a transform; rendering a phone-width world at iPad width wastes pixels.
export const islandBaseScale = (width: number, height: number) =>
  Math.min(width / 1024, height / 1700);
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
