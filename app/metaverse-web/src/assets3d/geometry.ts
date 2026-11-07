import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  Uint16BufferAttribute,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type V3 = [number, number, number];

// 같은 시드면 같은 섬이 나오도록 결정적 난수를 쓴다.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash2(x: number, z: number) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function noise2(x: number, z: number) {
  const ix = Math.floor(x),
    iz = Math.floor(z),
    fx = x - ix,
    fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx),
    uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz),
    b = hash2(ix + 1, iz),
    c = hash2(ix, iz + 1),
    d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
// 회전한 좌표로 옥타브를 겹쳐 격자 방향 무늬가 생기지 않게 한다.
export function fbm(x: number, z: number, octaves = 3) {
  let sum = 0,
    amp = 0.5,
    px = x,
    pz = z;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(px, pz) * amp;
    const nx = px * 1.6 - pz * 1.2 + 17.3,
      nz = px * 1.2 + pz * 1.6 - 9.1;
    px = nx;
    pz = nz;
    amp *= 0.5;
  }
  return sum / (1 - Math.pow(0.5, octaves));
}
export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const tmpColor = new Color();
export function shadeColor(hex: string, amount: number) {
  tmpColor.set(hex);
  return amount >= 0
    ? tmpColor.lerp(new Color("#ffffff"), amount).getHexString()
    : tmpColor.lerp(new Color("#2a2420"), -amount).getHexString();
}

export type PartOptions = {
  // 주어지면 at/rot/scale 대신 이 변환을 쓴다(지붕 기와처럼 두 번 변환할 때).
  matrix?: Matrix4;
  at?: V3;
  rot?: V3;
  scale?: V3 | number;
  color: string | Color;
  // 부품마다 색을 조금 흔들어 판자·돌이 서로 다르게 보이게 한다.
  jitter?: number;
  // 아래(0)에서 위(1)로 밝기를 곱한다. [아래, 위]
  gradient?: [number, number];
  bone?: number;
  // 정점별 뼈 가중치를 직접 줄 때 사용한다(꼬리·몸통의 부드러운 굽힘).
  weights?: (p: Vector3) => [number, number, number, number, number, number];
  // 둥근 덩어리를 하나의 부피처럼 보이게 하는 법선 중심.
  softCenter?: V3;
  softAmount?: number;
  flat?: boolean;
};

// 여러 부품을 정점 색이 있는 하나의 geometry로 합친다. 장면의 draw call을 줄이는 기본 도구다.
export class Builder {
  private parts: BufferGeometry[] = [];
  private random: () => number;
  constructor(seed = 1) {
    this.random = rng(seed);
  }
  rand() {
    return this.random();
  }
  add(source: BufferGeometry, options: PartOptions) {
    let g = options.flat
      ? source.index
        ? source.toNonIndexed()
        : source.clone()
      : source.clone();
    if (options.flat) g.computeVertexNormals();
    if (!g.getAttribute("uv"))
      g.setAttribute(
        "uv",
        new Float32BufferAttribute(
          new Float32Array(g.attributes.position.count * 2),
          2,
        ),
      );
    for (const name of Object.keys(g.attributes))
      if (name !== "position" && name !== "normal" && name !== "uv")
        g.deleteAttribute(name);
    const position = g.getAttribute("position") as BufferAttribute;
    const count = position.count;
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 0; i < count; i++) {
      minY = Math.min(minY, position.getY(i));
      maxY = Math.max(maxY, position.getY(i));
    }
    const scale =
      options.scale === undefined
        ? new Vector3(1, 1, 1)
        : typeof options.scale === "number"
          ? new Vector3(options.scale, options.scale, options.scale)
          : new Vector3(...options.scale);
    const matrix =
      options.matrix ??
      new Matrix4().compose(
        new Vector3(...(options.at ?? [0, 0, 0])),
        new Quaternion().setFromEuler(new Euler(...(options.rot ?? [0, 0, 0]))),
        scale,
      );
    g.applyMatrix4(matrix);
    const base = new Color(options.color);
    if (options.jitter) {
      const j = (this.random() - 0.5) * options.jitter;
      base.offsetHSL(0, 0, j);
    }
    const colors = new Float32Array(count * 3);
    const local = new Vector3();
    for (let i = 0; i < count; i++) {
      let k = 1;
      if (options.gradient) {
        const t =
          maxY > minY
            ? (local.fromBufferAttribute(position, i).y - minY) / (maxY - minY)
            : 1;
        k =
          options.gradient[0] + (options.gradient[1] - options.gradient[0]) * t;
      }
      colors[i * 3] = base.r * k;
      colors[i * 3 + 1] = base.g * k;
      colors[i * 3 + 2] = base.b * k;
    }
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    if (options.softCenter) {
      const c = new Vector3(...options.softCenter),
        normals = g.getAttribute("normal") as BufferAttribute,
        p = new Vector3(),
        n = new Vector3(),
        s = new Vector3(),
        amount = options.softAmount ?? 0.7;
      const moved = g.getAttribute("position") as BufferAttribute;
      for (let i = 0; i < count; i++) {
        p.fromBufferAttribute(moved, i);
        n.fromBufferAttribute(normals, i);
        s.copy(p).sub(c).normalize();
        n.lerp(s, amount).normalize();
        normals.setXYZ(i, n.x, n.y, n.z);
      }
    }
    if (options.bone !== undefined || options.weights) {
      const indices = new Uint16Array(count * 4),
        weights = new Float32Array(count * 4),
        moved = g.getAttribute("position") as BufferAttribute,
        p = new Vector3();
      for (let i = 0; i < count; i++) {
        if (options.weights) {
          p.fromBufferAttribute(moved, i);
          const [b0, w0, b1, w1, b2, w2] = options.weights(p);
          indices.set([b0, b1, b2, 0], i * 4);
          weights.set([w0, w1, w2, 0], i * 4);
        } else {
          indices[i * 4] = options.bone!;
          weights[i * 4] = 1;
        }
      }
      g.setAttribute("skinIndex", new Uint16BufferAttribute(indices, 4));
      g.setAttribute("skinWeight", new Float32BufferAttribute(weights, 4));
    }
    if (!g.index) {
      const index = new Uint32Array(count);
      for (let i = 0; i < count; i++) index[i] = i;
      g.setIndex(new BufferAttribute(index, 1));
    }
    this.parts.push(g);
    return this;
  }
  get size() {
    return this.parts.length;
  }
  build() {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error("geometry merge failed");
    for (const part of this.parts) part.dispose();
    this.parts = [];
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

// 하나의 판·판자를 둥근 모서리 상자로 만든다. drei RoundedBox 대신 합치기 쉬운 geometry를 돌려준다.
export function roundedBox(w: number, h: number, d: number, r = 0.04, s = 2) {
  const g = new BoxGeometry(w, h, d, s + 1, s + 1, s + 1);
  const p = g.getAttribute("position") as BufferAttribute;
  const hw = w / 2 - r,
    hh = h / 2 - r,
    hd = d / 2 - r,
    v = new Vector3(),
    inner = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    inner.set(
      Math.max(-hw, Math.min(hw, v.x)),
      Math.max(-hh, Math.min(hh, v.y)),
      Math.max(-hd, Math.min(hd, v.z)),
    );
    const offset = v.clone().sub(inner);
    if (offset.lengthSq() > 1e-8) offset.normalize().multiplyScalar(r);
    p.setXYZ(i, inner.x + offset.x, inner.y + offset.y, inner.z + offset.z);
  }
  g.computeVertexNormals();
  return g;
}

// 잎 덩어리·바위처럼 울퉁불퉁한 덩어리. 정점을 노이즈로 밀어 둥근 덩어리마다 다른 모양을 만든다.
export function lumpy(
  radius: number,
  detail: number,
  amount: number,
  seed: number,
) {
  const g = new IcosahedronGeometry(radius, detail);
  const p = g.getAttribute("position") as BufferAttribute,
    v = new Vector3();
  const random = rng(seed);
  const ox = random() * 50,
    oz = random() * 50;
  const moved = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
    let k = moved.get(key);
    if (k === undefined) {
      k =
        1 + (fbm(v.x * 2.1 + ox, v.z * 2.1 + v.y * 1.7 + oz, 2) - 0.5) * amount;
      moved.set(key, k);
    }
    p.setXYZ(i, v.x * k, v.y * k, v.z * k);
  }
  g.computeVertexNormals();
  return g;
}

export function compose(at: V3, rot: V3 = [0, 0, 0], scale: V3 | number = 1) {
  return new Matrix4().compose(
    new Vector3(...at),
    new Quaternion().setFromEuler(new Euler(...rot)),
    typeof scale === "number"
      ? new Vector3(scale, scale, scale)
      : new Vector3(...scale),
  );
}
