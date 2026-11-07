import { useId } from "react";
import { Icon } from "./Icon";
import { CAPACITY, FOCUS_SEATS, SEAT_SECTIONS, getFocusSeat } from "./layout";
import type {
  FocusResult,
  FocusSession,
  SeatReservation,
} from "./focus-session";

export const SUBJECT_MAX = 40;
const pad = (value: number) => String(value).padStart(2, "0");

export function formatClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}
export function spokenDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600),
    minutes = Math.floor(total / 60) % 60,
    seconds = total % 60;
  return [
    hours > 0 && `${hours}시간`,
    minutes > 0 && `${minutes}분`,
    (seconds > 0 || total < 60) && `${seconds}초`,
  ]
    .filter(Boolean)
    .join(" ");
}
export function seatName(seatId: number) {
  const seat = getFocusSeat(seatId);
  return seat
    ? `${seatId + 1}번 의자 · ${SEAT_SECTIONS[seat.ring]}`
    : `${seatId + 1}번 의자`;
}
export const subjectText = (subject: string | undefined) =>
  subject?.trim() || "집중";

// 낚시섬에 도착해 아직 앉지 않았을 때. 앉는 순간 집중이 시작되므로 확인 단계를 두지 않는다.
export function FocusPrepare({
  subject,
  onSubject,
  onPickSeat,
  onHome,
  pickDisabled,
  homeDisabled,
  notice,
}: {
  subject: string;
  onSubject: (value: string) => void;
  onPickSeat: () => void;
  onHome: () => void;
  pickDisabled: boolean;
  homeDisabled: boolean;
  notice: string | null;
}) {
  const inputId = useId();
  return (
    <section className="focus-prepare" aria-label="집중 준비">
      <div className="subject-field">
        <label htmlFor={inputId}>오늘의 할 일</label>
        <span aria-hidden="true">
          {subject.length}/{SUBJECT_MAX}
        </span>
      </div>
      <input
        id={inputId}
        type="text"
        maxLength={SUBJECT_MAX}
        value={subject}
        placeholder="할 일 입력 (선택)"
        enterKeyHint="next"
        autoComplete="off"
        onChange={(e) => onSubject(e.target.value.slice(0, SUBJECT_MAX))}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.nativeEvent.isComposing &&
            !pickDisabled
          ) {
            e.preventDefault();
            onPickSeat();
          }
        }}
      />
      <div className="prepare-actions">
        <button
          className="primary"
          data-autofocus
          onClick={onPickSeat}
          disabled={pickDisabled}
        >
          <Icon name="seat" />
          <span>자리 고르기</span>
        </button>
        <button onClick={onHome} disabled={homeDisabled}>
          <Icon name="home" />
          <span>우리 섬으로</span>
        </button>
      </div>
      <p className="prepare-note">
        {notice ?? "물가의 빈 의자를 누르면 바로 앉아 낚시를 시작해요."}
      </p>
    </section>
  );
}

// 집중 중에는 낚시섬 의자에서, 휴식 중에는 우리 섬 모닥불 곁에서 같은 시간을 보여 준다.
export function FocusHud({
  session,
  elapsedMs,
}: {
  session: FocusSession;
  elapsedMs: number;
}) {
  const paused = session.status === "paused";
  return (
    <section
      className="focus-hud"
      data-state={session.status}
      aria-label={paused ? "휴식 중" : "낚시하며 집중 중"}
    >
      <p className="focus-subject">{subjectText(session.subject)}</p>
      <strong
        className="focus-clock"
        role="timer"
        aria-label={`집중 시간 ${spokenDuration(elapsedMs)}${paused ? " · 멈춤" : ""}`}
      >
        {formatClock(elapsedMs)}
      </strong>
      <p className="focus-caption">
        <Icon name={paused ? "fire" : "fish"} size={16} />
        <span>
          <span>
            {paused ? "모닥불 곁에서 쉬는 중" : "낚시하며 집중하는 중"}
          </span>
          <span>
            {paused
              ? `${session.seatId + 1}번 의자 맡아 둠`
              : seatName(session.seatId)}
          </span>
        </span>
      </p>
    </section>
  );
}

// 의자 30개를 물가 세 구역으로 나눠 키보드·화면 읽기로도 고를 수 있게 한다.
export function SeatPicker({
  reservations,
  mySeatId,
  pendingSeatId,
  disabled,
  notice,
  onSelect,
}: {
  reservations: ReadonlyMap<number, SeatReservation>;
  mySeatId: number | null;
  pendingSeatId: number | null;
  disabled: boolean;
  notice: string | null;
  onSelect: (seatId: number) => void;
}) {
  const baseId = useId();
  const free = CAPACITY - reservations.size;
  return (
    <>
      <p className="seat-summary" role="status">
        <span>
          빈 의자 <strong>{Math.max(0, free)}</strong>/{CAPACITY}
        </span>
        {notice && <span className="seat-notice">{notice}</span>}
      </p>
      {SEAT_SECTIONS.map((section, ring) => (
        <section
          className="seat-row"
          key={section}
          aria-labelledby={`${baseId}-${ring}`}
        >
          <h3 id={`${baseId}-${ring}`}>{section}</h3>
          <div className="seat-grid">
            {FOCUS_SEATS.filter((seat) => seat.ring === ring).map((seat) => {
              const own = seat.id === mySeatId;
              const taken = reservations.get(seat.id);
              const pending = seat.id === pendingSeatId;
              const state = own
                ? "내 자리"
                : pending
                  ? "앉는 중"
                  : taken
                    ? taken.status === "paused"
                      ? `휴식 중 · ${taken.name}`
                      : `사용 중 · ${taken.name}`
                    : "비어 있음";
              return (
                <button
                  key={seat.id}
                  data-seat={own ? "mine" : taken ? taken.status : "free"}
                  disabled={
                    disabled || own || pendingSeatId !== null || Boolean(taken)
                  }
                  aria-label={`${seat.id + 1}번 의자 · ${state}`}
                  aria-pressed={own}
                  onClick={() => onSelect(seat.id)}
                >
                  <span>{seat.id + 1}</span>
                  <small>
                    {own
                      ? "나"
                      : pending
                        ? "앉는 중"
                        : taken
                          ? taken.status === "paused"
                            ? "휴식"
                            : "집중"
                          : "빈자리"}
                  </small>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p className="seat-footnote">
        분홍색은 내 자리, 흐린 의자는 다른 주민이 집중하거나 쉬는 동안 맡아 둔
        자리예요.
      </p>
    </>
  );
}

// 이번 세션에서 실제로 받은 할 일과 집중 시간만 보여 준다.
export function FocusResultSummary({
  result,
  error,
}: {
  result: FocusResult;
  error: string | null;
}) {
  return (
    <>
      <dl className="result-summary">
        <div>
          <dt>오늘의 할 일</dt>
          <dd>{subjectText(result.subject)}</dd>
        </div>
        <div>
          <dt>이번 집중 시간</dt>
          <dd>
            <strong aria-label={spokenDuration(result.elapsedMs)}>
              {formatClock(result.elapsedMs)}
            </strong>
          </dd>
        </div>
      </dl>
      {error && (
        <p className="dialog-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
