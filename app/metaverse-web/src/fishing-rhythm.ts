// 의자 낚시의 어획 박자. 화면 연출 전용이라 집중 타이머·좌석·서버 명령과 무관하고 물고기를 세지 않는다.
// 앉아서 낚시한 프레임 시간만 센다. 프레임이 멈춘 숨긴 탭은 시간이 흐르지 않고, 한 프레임에 0.1초보다
// 많이 진행하지 않아 탭을 다시 열어도 물고기가 순간이동하거나 여러 마리를 연달아 낚지 않는다.
export const CATCH_LENGTH = 7; // catPose.ts의 CATCH_SECONDS와 같다(tests/fishing.test.ts가 확인).
export const MAX_FRAME_STEP = 0.1;
// 동작 줄이기로 어획을 멈췄다가 다시 켜면 이만큼 기다렸다 낚는다.
const RESUME_AFTER = 4;

export type FishingPlan = {
  /** 의자에 앉은 뒤 첫 입질까지(초) */
  first: readonly [number, number];
  /** 이미 앉아 있는 고양이를 처음 볼 때 첫 입질까지(초). 섬에 들어서자마자 모두 함께 낚지 않게 퍼뜨린다. */
  settled?: readonly [number, number];
  /** 어획이 끝난 뒤 다음 입질까지(초) */
  gap: readonly [number, number];
};
/** 내 고양이: 앉은 지 7초쯤 첫 물고기, 이후 20~35초마다. */
export const MY_FISHING: FishingPlan = { first: [7, 7], gap: [20, 35] };
/** 다른 고양이: 앉는 모습을 보면 6~10초 뒤, 이미 앉아 있었으면 2~30초 사이에 흩어서. */
export const OTHERS_FISHING: FishingPlan = {
  first: [6, 10],
  settled: [2, 30],
  gap: [20, 35],
};

export class FishingRhythm {
  private clock = 0;
  private next = Infinity;
  private start = -1;
  private seat: number | null = null;
  private settled: boolean;
  constructor(
    private plan: FishingPlan,
    private random: () => number = Math.random,
    settled = false,
  ) {
    this.settled = settled && !!plan.settled;
  }
  private pick([min, max]: readonly [number, number]) {
    return min + (max - min) * this.random();
  }
  /**
   * 한 프레임 진행한다. seat는 앉은 의자를 구분하는 값(서지 않았으면 null)이며, 바뀌면 새로 앉은 것으로
   * 본다. 물고기를 낚는 중이면 시작부터 지난 초(0 이상 CATCH_LENGTH 미만), 아니면 -1을 돌려준다.
   */
  step(dt: number, seat: number | null, reduced: boolean): number {
    if (seat !== this.seat) {
      this.seat = seat;
      this.clock = 0;
      this.start = -1;
      if (seat === null) this.next = Infinity;
      else {
        this.next = this.pick(
          this.settled ? this.plan.settled! : this.plan.first,
        );
        this.settled = false;
      }
    }
    if (seat === null) return -1;
    if (reduced) {
      if (this.start >= 0) {
        this.start = -1;
        this.next = this.clock + RESUME_AFTER;
      }
      return -1;
    }
    this.clock += Math.min(
      Math.max(Number.isFinite(dt) ? dt : 0, 0),
      MAX_FRAME_STEP,
    );
    if (this.start < 0 && this.clock >= this.next) this.start = this.clock;
    if (this.start < 0) return -1;
    const elapsed = this.clock - this.start;
    if (elapsed < CATCH_LENGTH) return elapsed;
    this.start = -1;
    this.next = this.clock + this.pick(this.plan.gap);
    return -1;
  }
  /** 다음 입질까지 남은 앉은 시간(초). 낚는 중이면 0. 검증용. */
  get untilNext() {
    return this.start >= 0 ? 0 : Math.max(0, this.next - this.clock);
  }
}
