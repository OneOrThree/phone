import { CanvasTexture, SRGBColorSpace } from "three";

// 런타임에 그리는 작은 텍스처. 외부 파일을 내려받지 않는다.
let blob: CanvasTexture | null = null;
export function blobShadowTexture() {
  if (blob) return blob;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  blob = new CanvasTexture(canvas);
  blob.colorSpace = SRGBColorSpace;
  return blob;
}

let ember: CanvasTexture | null = null;
export function softDotTexture() {
  if (ember) return ember;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 15);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.7)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  ember = new CanvasTexture(canvas);
  return ember;
}
