/**
 * 개발·테스트 전용 손가락 흉내(GROMO-2289) — 판(View)의 PanResponder 핸들러에 진짜 터치와 같은 모양의 이벤트
 * (nativeEvent 의 page/location 좌표·touches + RN 의 touchHistory)를 넣는다. jest 와 시뮬레이터 미리보기 대본이 같이 쓴다.
 * 제품 화면은 이 파일을 쓰지 않는다.
 */
type Pt = { x: number; y: number };
type Track = {
  touchActive: boolean;
  startPageX: number;
  startPageY: number;
  startTimeStamp: number;
  currentPageX: number;
  currentPageY: number;
  currentTimeStamp: number;
  previousPageX: number;
  previousPageY: number;
  previousTimeStamp: number;
};
type Handlers = {
  onResponderGrant?: (e: any) => unknown;
  onResponderStart?: (e: any) => unknown;
  onResponderMove?: (e: any) => unknown;
  onResponderRelease?: (e: any) => unknown;
};

/**
 * points 는 판 안 좌표(locationX/Y)다. origin 은 판의 화면 위치(pageX = origin + location) — 아무 값이어도 결과는 같다.
 */
export function createTouchDriver(handlers: Handlers, origin: Pt = { x: 30, y: 200 }) {
  let time = 1;
  const bank: Track[] = [];
  const active = () => bank.map((t, i) => [t, i] as const).filter(([t]) => t.touchActive);
  const event = (index: number) => {
    const list = active();
    const t = bank[index];
    return {
      nativeEvent: {
        identifier: index,
        pageX: t.currentPageX,
        pageY: t.currentPageY,
        locationX: t.currentPageX - origin.x,
        locationY: t.currentPageY - origin.y,
        timestamp: time,
        touches: list.map(([track, i]) => ({
          identifier: i,
          pageX: track.currentPageX,
          pageY: track.currentPageY,
          locationX: track.currentPageX - origin.x,
          locationY: track.currentPageY - origin.y,
        })),
        changedTouches: [],
      },
      touchHistory: {
        touchBank: bank,
        numberActiveTouches: list.length,
        indexOfSingleActiveTouch: list.length === 1 ? list[0][1] : -1,
        mostRecentTimeStamp: time,
      },
    };
  };
  const put = (index: number, p: Pt) => {
    const t = bank[index];
    t.previousPageX = t.currentPageX;
    t.previousPageY = t.currentPageY;
    t.previousTimeStamp = t.currentTimeStamp;
    t.currentPageX = p.x + origin.x;
    t.currentPageY = p.y + origin.y;
    t.currentTimeStamp = time;
  };
  const touch = (index: number, p: Pt) => {
    bank[index] = {
      touchActive: true,
      startPageX: p.x + origin.x,
      startPageY: p.y + origin.y,
      startTimeStamp: time,
      currentPageX: p.x + origin.x,
      currentPageY: p.y + origin.y,
      currentTimeStamp: time,
      previousPageX: p.x + origin.x,
      previousPageY: p.y + origin.y,
      previousTimeStamp: time,
    };
  };
  return {
    /** 첫 손가락을 댄다(responder 가 된다). */
    down(p: Pt) {
      time++;
      touch(0, p);
      handlers.onResponderGrant?.(event(0));
    },
    /** 두 번째 손가락을 댄다. */
    second(p: Pt) {
      time++;
      touch(1, p);
      handlers.onResponderStart?.(event(1));
    },
    /** 손가락들을 옮긴다 — points[i] 가 i 번째 손가락의 새 위치(없으면 그대로). */
    move(...points: (Pt | undefined)[]) {
      time++;
      points.forEach((p, i) => p && bank[i]?.touchActive && put(i, p));
      handlers.onResponderMove?.(event(0));
    },
    /** i 번째 손가락만 뗀다(나머지는 그대로 대고 있다). */
    lift(index: number) {
      time++;
      bank[index].touchActive = false;
    },
    /** 모든 손가락을 뗀다. */
    up() {
      time++;
      const last = active()[0]?.[1] ?? 0;
      bank.forEach((t) => (t.touchActive = false));
      handlers.onResponderRelease?.(event(last));
    },
    /** 한 손가락 끌기 한 번(steps 번 나눠 움직인다). */
    drag(from: Pt, to: Pt, steps = 6) {
      this.down(from);
      for (let s = 1; s <= steps; s++)
        this.move({
          x: from.x + ((to.x - from.x) * s) / steps,
          y: from.y + ((to.y - from.y) * s) / steps,
        });
      this.up();
    },
  };
}
