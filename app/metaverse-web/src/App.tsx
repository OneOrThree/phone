import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
const Scene = lazy(() => import("./Scene").then((m) => ({ default: m.Scene })));
import { Simulation } from "./simulation";
import { editingText, movementKey } from "./keyboard";
import type { ZoomRequest } from "./CameraRig";
import { useRoom } from "./realtime";
import { useIslandAudio } from "./useIslandAudio";
import { BUILDINGS, CAPACITY, DOCK_POINT, REST_POINT } from "./layout";
import {
  focusElapsedMs,
  type FocusResult,
  type IslandId,
  type SeatReservation,
} from "./focus-session";
import { validName, type Action } from "./world";
import { readProfile, saveProfile } from "./profile";
import { AppearanceFields } from "./AppearanceFields";
import { Icon, type IconName } from "./Icon";
import { Dialog } from "./Dialog";
import { HoldButton } from "./HoldButton";
import {
  FocusHud,
  FocusPrepare,
  FocusResultSummary,
  SeatPicker,
  SUBJECT_MAX,
  seatName,
  subjectText,
} from "./FocusControls";

type Phase = "home" | "prepare" | "focusing" | "resting";
type Panel = "help" | "settings" | "places" | "seats" | null;
const actionLabels: Record<Action, string> = {
  idle: "산책 중",
  walk: "걸어가는 중",
  wave: "반가워요!",
  fish: "바다를 바라보는 중",
  sit: "잠시 쉬는 중",
  focus: "물가에서 낚시하며 집중 중",
};
const islandCopy: Record<
  IslandId,
  { chip: string; title: string; subtitle: string; icon: IconName }
> = {
  home: {
    chip: "우리 섬",
    title: "느긋한 오후의 섬",
    subtitle: "모닥불 곁에서 쉬고, 이웃과 인사해요",
    icon: "home",
  },
  focus: {
    chip: "낚시섬",
    title: "물가의 낚시섬",
    subtitle: "연못가 의자에 앉아 함께 집중해요",
    icon: "fish",
  },
};
class SceneBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? (
      <div className="fallback">
        <Icon name="paw" size={48} />
        <h2>섬을 그리지 못했어요</h2>
        <p>브라우저의 그래픽 가속을 켜고 다시 열어 주세요.</p>
        <button onClick={() => location.reload()}>다시 불러오기</button>
      </div>
    ) : (
      this.props.children
    );
  }
}
function Stick({ sim }: { sim: Simulation }) {
  const [thumb, setThumb] = useState({ x: 0, z: 0 });
  const update = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let x = (e.clientX - rect.left - rect.width / 2) / 32,
      z = (e.clientY - rect.top - rect.height / 2) / 32;
    const length = Math.max(1, Math.hypot(x, z));
    x /= length;
    z /= length;
    sim.stick = { x, z };
    setThumb({ x, z });
  };
  const end = () => {
    sim.stick = { x: 0, z: 0 };
    setThumb({ x: 0, z: 0 });
  };
  // 집중을 시작하며 조이스틱이 사라져도 누르던 방향이 남지 않게 한다.
  useEffect(
    () => () => {
      sim.stick = { x: 0, z: 0 };
    },
    [sim],
  );
  return (
    <div
      className="joystick"
      aria-hidden="true"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) update(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <span
        style={{ transform: `translate(${thumb.x * 28}px,${thumb.z * 28}px)` }}
      >
        <Icon name="paw" />
      </span>
    </div>
  );
}
export function App() {
  const [profile] = useState(readProfile);
  const [joined, setJoined] = useState(Boolean(profile));
  const [sim] = useState(() => {
    const next = new Simulation();
    if (profile) Object.assign(next.actor, profile);
    return next;
  });
  const {
    status,
    residents,
    reservations,
    session,
    pendingSeatId,
    busy,
    seatError,
    claimSeat,
    travel,
    pauseFocus,
    resumeFocus,
    finishFocus,
    leaveSeat,
  } = useRoom(sim, { enabled: joined });
  const releaseSeat = useRef(leaveSeat);
  releaseSeat.current = leaveSeat;
  const [failed, setFailed] = useState(false);
  const [cameraMode, setCameraMode] = useState<"follow" | "overview">("follow");
  const [zoom, setZoom] = useState<ZoomRequest>({ id: 0, direction: "in" });
  const changeZoom = (direction: "in" | "out") =>
    setZoom((v) => ({ id: v.id + 1, direction }));
  const [reset, setReset] = useState(0),
    [ready, setReady] = useState(false),
    [lost, setLost] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [reduced, setReduced] = useState(false),
    [systemReduced, setSystemReduced] = useState(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [low, setLow] = useState(false);
  const [name, setName] = useState(profile?.name ?? ""),
    [color, setColor] = useState(sim.actor.color);
  const [message, setMessage] = useState("");
  const [pose, setPose] = useState({ ...sim.actor }),
    [now, setNow] = useState(() => Date.now());
  const [subject, setSubject] = useState("");
  const [result, setResult] = useState<FocusResult | null>(null),
    [resultError, setResultError] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [crossing, setCrossing] = useState<IslandId | null>(null);
  const island: IslandId = pose.island === "focus" ? "focus" : "home";
  const phase: Phase = session
    ? session.status === "paused"
      ? "resting"
      : "focusing"
    : island === "focus"
      ? "prepare"
      : "home";
  const online = status === "online";
  const locked = !joined || !ready || lost || failed;
  const commandLocked = locked || busy || !online;
  const audio = useIslandAudio(Boolean(session) && !failed && !lost);
  // 예약은 휴식 중인 자리도 포함한다. 내 자리는 세션의 의자 번호로 구분한다.
  const reservationBySeat = new Map<number, SeatReservation>(
    reservations.map((r) => [r.seatId, r]),
  );
  const occupied = new Map(reservations.map((r) => [r.seatId, r.name]));
  const mySeatId = session?.seatId ?? null;
  const activeSeatId =
    session && island === "focus" && pose.action === "focus"
      ? session.seatId
      : null;
  const islandResidents = residents.filter((r) => r.island === island);
  const freeSeats = Math.max(0, CAPACITY - reservations.length);
  const restingOthers = reservations.filter(
    (r) => r.status === "paused" && r.seatId !== mySeatId,
  ).length;
  const seatNotice = !online
    ? "섬에 다시 연결되면 의자에 앉을 수 있어요."
    : freeSeats === 0
      ? `지금은 낚시 의자 ${CAPACITY}개가 모두 사용 중이에요. 잠시 뒤 다시 골라 주세요.`
      : restingOthers > 0
        ? `쉬러 간 주민 ${restingOthers}명의 의자는 돌아올 때까지 맡아 둬요.`
        : null;
  const focusMs = focusElapsedMs(session, now);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  // 연결이 끊긴 렌더에서는 세션이 이미 비어 있으므로 마지막 온라인 세션을 따로 기억한다.
  const onlineSession = useRef(false);
  if (online)
    onlineSession.current = Boolean(session) || pendingSeatId !== null;
  const mainRef = useRef<HTMLElement>(null),
    bottomRef = useRef<HTMLDivElement>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const announce = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 4200);
  }, []);
  const announceRef = useRef(announce);
  announceRef.current = announce;
  const sync = useCallback(() => setPose({ ...sim.actor }), [sim]);
  const onReady = useCallback(() => setReady(true), []);
  const [cancelledByGraphics, setCancelledByGraphics] = useState(false);
  const emergencyStop = useCallback(() => {
    // 그래픽이 멈추면 결과 없이 자리를 비우고 모닥불 소리도 끈다.
    if (sessionRef.current) setCancelledByGraphics(true);
    releaseSeat.current();
    sim.stop();
    setPanel(null);
    setResult(null);
    setPose({ ...sim.actor });
  }, [sim]);
  const onFailure = useCallback(() => {
    emergencyStop();
    setReady(true);
    setFailed(true);
  }, [emergencyStop]);
  useEffect(() => {
    if (seatError) announce(seatError);
  }, [seatError, announce]);
  useEffect(() => {
    if (online || !onlineSession.current) return;
    onlineSession.current = false;
    sim.stop();
    setPanel(null);
    setInterrupted(true);
  }, [online, sim]);
  // 장면이 바뀌면 열려 있던 다른 섬의 메뉴를 닫는다.
  useEffect(() => {
    if (panel === "seats" && phase !== "prepare" && phase !== "focusing")
      setPanel(null);
    if (panel === "places" && phase !== "home") setPanel(null);
  }, [panel, phase]);
  useEffect(() => {
    sim.stop();
    setCameraMode("follow");
  }, [phase, island, sim]);

  const selectSeat = async (seatId: number) => {
    if (locked || busy || pendingSeatId !== null) return;
    if (island !== "focus" || session?.status === "paused") return;
    audio.unlock();
    setPanel(null);
    if (seatId === mySeatId) return;
    if (!online) {
      announce("섬에 다시 연결되면 의자에 앉을 수 있어요.");
      return;
    }
    const taken = reservationBySeat.get(seatId);
    if (taken) {
      announce(
        taken.status === "paused"
          ? `${seatId + 1}번 의자는 ${taken.name}님이 쉬는 동안 맡아 둔 자리예요.`
          : `${seatId + 1}번 의자에는 ${taken.name}님이 앉아 있어요.`,
      );
      return;
    }
    const moving = Boolean(session);
    const ok = await claimSeat(
      seatId,
      moving ? undefined : subject.trim().slice(0, SUBJECT_MAX),
    );
    sync();
    if (!ok) {
      // 서버가 이유를 보내면 seatError 안내가 이 문구를 덮는다.
      announce("의자에 앉지 못했어요. 다른 의자를 골라 주세요.");
      return;
    }
    sim.stop();
    announce(
      moving
        ? `${seatName(seatId)}로 옮겼어요. 시간은 이어서 흘러요.`
        : `${seatName(seatId)}에 앉아 낚시를 시작했어요.`,
    );
  };
  const goTo = async (target: IslandId) => {
    if (locked || busy || session) return false;
    audio.unlock();
    setPanel(null);
    if (sim.actor.island === target) return true;
    setCrossing(target);
    const ok = await travel(target);
    setCrossing(null);
    sync();
    announce(
      ok
        ? target === "focus"
          ? "낚시섬에 도착했어요. 물가의 빈 의자를 골라 앉아 보세요."
          : "우리 섬으로 돌아왔어요."
        : "뗏목을 띄우지 못했어요. 잠시 뒤 다시 눌러 주세요.",
    );
    return ok;
  };
  const pause = async () => {
    if (commandLocked || session?.status !== "focusing") return;
    setPanel(null);
    const ok = await pauseFocus();
    sync();
    if (ok)
      announce(
        "우리 섬 모닥불 곁에서 쉬어요. 시간은 멈추고 의자는 맡아 둘게요.",
      );
    else announce("휴식으로 이동하지 못했어요.");
  };
  const resume = async () => {
    if (commandLocked || session?.status !== "paused") return;
    const ok = await resumeFocus();
    sync();
    if (ok && sessionRef.current)
      announce(
        `${seatName(sessionRef.current.seatId)}로 돌아와 이어서 집중해요.`,
      );
    else if (!ok) announce("집중을 이어가지 못했어요.");
  };
  const finish = async () => {
    if (commandLocked || !session) return;
    setPanel(null);
    const done = await finishFocus();
    sync();
    if (done) {
      setResultError(null);
      setResult(done);
    } else announce("집중을 마치지 못했어요. 다시 길게 눌러 주세요.");
  };
  const focusAgain = async () => {
    setResultError(null);
    if (sim.actor.island !== "focus" && !(await goTo("focus"))) {
      setResultError("낚시섬으로 건너가지 못했어요. 다시 눌러 주세요.");
      return;
    }
    setResult(null);
    announce("할 일을 적고 새 의자를 골라 주세요.");
  };
  const backHome = async () => {
    setResultError(null);
    if (await goTo("home")) setResult(null);
    else setResultError("우리 섬으로 건너가지 못했어요. 다시 눌러 주세요.");
  };
  const toggleSound = () => {
    if (audio.state === "playing" || audio.state === "loading") audio.toggle();
    else {
      if (audio.volume === 0) audio.setVolume(0.35);
      if (!audio.enabled) audio.toggle();
      else audio.unlock();
    }
  };
  const modalOpen = !joined || Boolean(panel) || Boolean(result) || interrupted;
  sim.reducedMotion = reduced || systemReduced;
  sim.blocked = modalOpen || lost || failed || !ready;
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(motion.matches);
    motion.addEventListener("change", change);
    const contextLost = () => {
      emergencyStop();
      setLost(true);
    };
    window.addEventListener("cattus-context-lost", contextLost);
    const tick = setInterval(() => {
      if (document.hidden) return;
      setPose({ ...sim.actor });
      setNow(Date.now());
    }, 200);
    return () => {
      clearInterval(tick);
      clearTimeout(toastTimer.current);
      motion.removeEventListener("change", change);
      window.removeEventListener("cattus-context-lost", contextLost);
    };
  }, [sim, emergencyStop]);
  useEffect(() => {
    if (modalOpen) sim.stop();
  }, [modalOpen, sim]);
  // 누른 버튼이 단계 전환으로 사라지면 다음 단계의 주요 버튼으로 포커스를 옮긴다.
  useEffect(() => {
    if (modalOpen) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    bottomRef.current
      ?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")
      ?.focus({ preventScroll: true });
  }, [phase, modalOpen]);
  // 휴대폰에서는 아래 패널 높이에 맞춰 조이스틱·시점 버튼을 올린다.
  useLayoutEffect(() => {
    const bottom = bottomRef.current,
      main = mainRef.current;
    if (!bottom || !main) return;
    const measure = () =>
      main.style.setProperty(
        "--bottom-h",
        `${Math.ceil(bottom.getBoundingClientRect().height)}px`,
      );
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bottom);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (
        sim.blocked ||
        editingText(e.target) ||
        e.altKey ||
        e.metaKey ||
        e.ctrlKey
      )
        return;
      const move = movementKey(e);
      const key = e.key.toLowerCase();
      if (
        e.code === "Equal" ||
        e.code === "NumpadAdd" ||
        e.code === "Minus" ||
        e.code === "NumpadSubtract"
      ) {
        e.preventDefault();
        changeZoom(e.code === "Equal" || e.code === "NumpadAdd" ? "in" : "out");
        return;
      }
      if (e.code === "KeyR" && !e.repeat) {
        e.preventDefault();
        setReset((v) => v + 1);
        return;
      }
      if (sessionRef.current || sim.actor.action === "focus") {
        // 집중·휴식 중에는 키를 눌러도 의자나 모닥불 곁을 떠나지 않는다.
        if (move) {
          e.preventDefault();
          sim.clearInput();
          if (!e.repeat)
            announceRef.current(
              sessionRef.current?.status === "paused"
                ? "쉬는 동안에는 모닥불 곁에 머물러요."
                : "집중하는 동안에는 의자에 앉아 있어요.",
            );
        }
        return;
      }
      if (move) {
        e.preventDefault();
        sim.keys.add(move);
      }
      if (
        key === " " &&
        !e.repeat &&
        !(e.target instanceof HTMLElement && e.target.closest("button,a"))
      ) {
        e.preventDefault();
        sim.action("wave");
        announceRef.current("반가운 마음을 전했어요.");
      }
      if (key === "escape") sim.stop();
    };
    const up = (e: KeyboardEvent) => {
      const move = movementKey(e);
      if (move) sim.keys.delete(move);
    };
    const focus = (e: FocusEvent) => {
      if (editingText(e.target)) sim.stop();
    };
    const stop = () => sim.stop();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", stop);
    document.addEventListener("focusin", focus);
    document.addEventListener("visibilitychange", stop);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", stop);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("visibilitychange", stop);
    };
  }, [sim]);
  const act = (action: Action) => {
    if (!sim.action(action)) return;
    announce(actionLabels[action]);
  };
  const walkTo = (
    point: { x: number; z: number },
    label: string,
    arrival: Action = "idle",
  ) => {
    setPanel(null);
    if (sim.moveTo(point, arrival)) announce(`${label}(으)로 걸어가요.`);
    else announce(`${label}까지 가는 길을 찾지 못했어요.`);
  };
  const items: { action: Action; icon: IconName; label: string }[] = [
    { action: "idle", icon: "walk", label: "산책" },
    { action: "wave", icon: "wave", label: "인사" },
    { action: "sit", icon: "rest", label: "쉬기" },
  ];
  const places: {
    name: string;
    desc: string;
    go: () => void;
    disabled?: boolean;
  }[] = [
    {
      name: "마을회관",
      desc: "우리 섬의 이야기가 시작되는 곳",
      go: () => walkTo(BUILDINGS.hall.entrance, "마을회관"),
    },
    {
      name: "강아지 상점",
      desc: "하늘색 지붕 아래 잠깐 쉬어 가요",
      go: () => walkTo(BUILDINGS.shop.entrance, "강아지 상점"),
    },
    {
      name: "모닥불",
      desc: "둘러앉아 쉬어 가는 곳",
      go: () => walkTo(REST_POINT, "모닥불", "sit"),
    },
    {
      name: "뗏목 부두",
      desc: "바다 건너 낚시섬으로 가는 뗏목이 머무는 곳",
      go: () => walkTo(DOCK_POINT, "뗏목 부두"),
    },
    {
      name: "낚시섬",
      desc: "뗏목을 타고 건너가 물가 의자에서 집중해요",
      go: () => void goTo("focus"),
      disabled: commandLocked,
    },
  ];
  const copy = islandCopy[island];
  const statusText =
    message ||
    (crossing
      ? crossing === "focus"
        ? "뗏목을 타고 낚시섬으로 건너가는 중…"
        : "뗏목을 타고 우리 섬으로 돌아가는 중…"
      : pendingSeatId !== null
        ? `${pendingSeatId + 1}번 의자에 앉는 중…`
        : phase === "home"
          ? actionLabels[pose.action]
          : phase === "prepare"
            ? "빈 의자를 고르면 바로 집중이 시작돼요"
            : "");
  return (
    <main
      ref={mainRef}
      className="app"
      data-island={island}
      data-phase={phase}
      data-camera={cameraMode}
      data-motion={sim.reducedMotion ? "reduced" : "full"}
      data-focus={
        session ? (session.status === "paused" ? "paused" : "active") : "idle"
      }
      aria-busy={busy || undefined}
      onPointerDownCapture={(e) => {
        if (!(
          e.target instanceof Element &&
          e.target.closest("[data-audio-control]")
        ))
          audio.unlock();
      }}
      onKeyDownCapture={(e) => {
        if (!(
          e.target instanceof Element &&
          e.target.closest("[data-audio-control]")
        ))
          audio.unlock();
      }}
    >
      <div
        className="world"
        role="region"
        aria-label={`고양이가 걷는 3D ${copy.chip}`}
        tabIndex={0}
        onPointerDownCapture={(e) =>
          e.currentTarget.focus({ preventScroll: true })
        }
        aria-describedby="controls-hint"
      >
        <SceneBoundary onFailure={onFailure}>
          <Suspense fallback={null}>
            <Scene
              island={island}
              sim={sim}
              residents={residents}
              reset={reset}
              zoom={zoom}
              onReady={onReady}
              onMove={(ok) => {
                const current = sessionRef.current;
                if (current) {
                  // 휴식 중 땅을 눌러도 모닥불 곁 자리를 지킨다.
                  if (ok) {
                    sim.stop();
                    sim.action("sit");
                  }
                  announce(
                    current.status === "paused"
                      ? "쉬는 동안에는 모닥불 곁에 머물러요. 집중 이어가기를 누르면 의자로 돌아가요."
                      : "집중하는 동안에는 의자에 앉아 있어요. 휴식하기나 종료하기를 눌러 주세요.",
                  );
                  return;
                }
                if (!ok) announce("길이나 빈 땅을 골라 주세요.");
              }}
              occupied={occupied}
              activeSeatId={activeSeatId}
              pendingSeatId={pendingSeatId}
              onSelectSeat={(id) => {
                if (!sim.blocked) void selectSeat(id);
              }}
              lowQuality={low}
              cameraMode={cameraMode}
            />
          </Suspense>
        </SceneBoundary>
      </div>
      {!ready && !lost && (
        <div className="loading" role="status">
          <Icon name="paw" size={36} />
          <p>함께 머물 섬을 준비하고 있어요</p>
        </div>
      )}
      <header className="topbar">
        <div className="identity">
          <a className="wordmark" href="./" aria-label="집중할고양 처음으로">
            <Icon name="paw" size={29} />
            cattus<span>3D 산책</span>
          </a>
          <div className="island-title">
            <span className="island-chip" data-island={island}>
              <Icon name={copy.icon} size={15} />
              {copy.chip}
            </span>
            <h1>{copy.title}</h1>
            <span>{copy.subtitle}</span>
          </div>
        </div>
        <div className="top-tools">
          <span className="weather">
            <Icon name="sun" size={19} /> 산책하기 좋은 오후
          </span>
          <button
            className="icon-button"
            data-audio-control
            onClick={toggleSound}
            aria-label={
              audio.state === "playing" || audio.state === "loading"
                ? "소리 끄기"
                : audio.state === "error"
                  ? "소리 다시 재생"
                  : "소리 켜기"
            }
            title={audio.state === "playing" ? "소리 끄기" : "소리 켜기"}
          >
            <Icon name={audio.state === "playing" ? "sound" : "mute"} />
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel("settings")}
            aria-label="내 고양이와 설정"
            title="내 고양이와 설정"
          >
            <Icon name="settings" />
          </button>
          <button
            className="icon-button"
            onClick={() => setPanel("help")}
            aria-label="조작 안내"
            title="조작 안내"
          >
            <Icon name="help" />
          </button>
        </div>
      </header>
      <div className="presence" role="status">
        <span className={`connection ${status}`} />
        <span>
          {!joined
            ? "이름을 정하고 섬에 들어오세요"
            : online
              ? `함께 있는 고양이 ${islandResidents.length + 1}`
              : status === "connecting"
                ? "섬에 연결 중"
                : "혼자 산책 중 · 다시 연결할게요"}
        </span>
        <small>
          낚시 의자 {reservations.length}/{CAPACITY}
        </small>
      </div>
      <div
        className="sound-status"
        role="status"
        data-audio-state={audio.state}
        data-audio-mode={audio.mode}
      >
        {audio.state === "playing"
          ? `${audio.mode === "focus" ? "모닥불 ASMR" : "숲바람"} 재생 중`
          : audio.state === "loading"
            ? "섬의 소리를 준비해요"
            : audio.state === "muted"
              ? "소리 꺼짐"
              : audio.state === "error"
                ? "소리 버튼을 눌러 다시 재생해 주세요"
                : "첫 클릭부터 섬의 소리가 들려요"}
      </div>
      {phase === "home" ? (
        <aside className="island-note">
          <span className="eyebrow">A LITTLE ISLAND OF OUR OWN</span>
          <h2>
            오늘은,
            <br />
            조금 느긋하게.
          </h2>
          <p>
            발길이 닿는 곳에 머물러요.
            <br />
            집중은 바다 건너 낚시섬에서.
          </p>
          <button
            className="text-button"
            onClick={() => setPanel("places")}
            disabled={locked}
          >
            섬 둘러보기 <Icon name="arrow" size={16} />
          </button>
        </aside>
      ) : (
        island === "focus" &&
        cameraMode === "overview" && (
          <aside className="island-note">
            <span className="eyebrow">FISHING ISLAND</span>
            <h2>
              물소리 곁에서,
              <br />한 가지에 집중.
            </h2>
            <p>
              연못을 둘러싼 의자 {CAPACITY}개.
              <br />
              앉으면 낚싯대를 드리우고 집중을 시작해요.
            </p>
          </aside>
        )
      )}
      <div className="camera-tools" role="group" aria-label="카메라 조작">
        <div className="camera-zoom">
          <button
            className="icon-button"
            disabled={locked}
            onClick={() => changeZoom("in")}
            aria-label="확대"
            title="확대 (+)"
          >
            <span aria-hidden="true">+</span>
          </button>
          <button
            className="icon-button"
            disabled={locked}
            onClick={() => changeZoom("out")}
            aria-label="축소"
            title="축소 (−)"
          >
            <span aria-hidden="true">−</span>
          </button>
        </div>
        <button
          className="camera-mode"
          onClick={() =>
            setCameraMode((mode) => (mode === "follow" ? "overview" : "follow"))
          }
          aria-label={
            cameraMode === "follow" ? "섬 전체 보기" : "고양이 따라가기"
          }
        >
          <Icon name={cameraMode === "follow" ? "sun" : "paw"} />
          <span>{cameraMode === "follow" ? "섬 전체" : "따라가기"}</span>
        </button>
        <button
          className="icon-button"
          onClick={() => {
            setReset((v) => v + 1);
            announce("처음 시점으로 돌아왔어요.");
          }}
          aria-label="시점 되돌리기"
          title="시점 되돌리기 (R)"
        >
          <Icon name="reset" />
        </button>
        <span className="camera-caption">시점</span>
      </div>
      <div className="bottom-area" ref={bottomRef}>
        <p className="sr-only" role="status">
          {message}
        </p>
        {statusText && (
          <div className="status-line" aria-hidden="true">
            <span>{statusText}</span>
          </div>
        )}
        {(phase === "focusing" || phase === "resting") && session && (
          <FocusHud session={session} elapsedMs={focusMs} />
        )}
        {phase === "home" && (
          <nav className="action-dock" aria-label="우리 섬에서 할 일">
            {items.map((item) => {
              const selected =
                pose.action === item.action ||
                (item.action === "idle" && pose.action === "walk");
              return (
                <button
                  key={item.action}
                  className={selected ? "selected" : ""}
                  onClick={() => act(item.action)}
                  aria-pressed={selected}
                  disabled={locked}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.action === "wave" && <kbd>Space</kbd>}
                </button>
              );
            })}
            <button
              className="primary"
              data-autofocus
              onClick={() => void goTo("focus")}
              disabled={commandLocked}
              aria-label="낚시섬으로 가기"
            >
              <Icon name="raft" />
              <span>
                낚시섬으로<span className="wide-only"> 가기</span>
              </span>
            </button>
          </nav>
        )}
        {phase === "prepare" && (
          <FocusPrepare
            subject={subject}
            onSubject={setSubject}
            onPickSeat={() => setPanel("seats")}
            onHome={() => void goTo("home")}
            pickDisabled={locked || busy}
            homeDisabled={commandLocked}
            notice={seatNotice}
          />
        )}
        {phase === "focusing" && (
          <nav className="action-dock focus-dock" aria-label="집중 중 할 일">
            <button
              onClick={() => setPanel("seats")}
              disabled={commandLocked || pendingSeatId !== null}
            >
              <Icon name="seat" />
              <span>자리 바꾸기</span>
            </button>
            <button
              className="primary"
              data-autofocus
              onClick={() => void pause()}
              disabled={commandLocked}
            >
              <Icon name="pause" />
              <span>휴식하기</span>
            </button>
            <HoldButton
              label="종료하기"
              cancelLabel="집중 종료 취소"
              hint="1.5초 동안 길게 누르면 집중을 종료해요. 중간에 손을 떼면 취소돼요."
              icon="stop"
              disabled={commandLocked}
              onConfirm={() => void finish()}
              onMessage={announce}
            />
          </nav>
        )}
        {phase === "resting" && (
          <nav className="action-dock rest-dock" aria-label="휴식 중 할 일">
            <button
              className="primary"
              data-autofocus
              onClick={() => void resume()}
              disabled={commandLocked}
            >
              <Icon name="play" />
              <span>집중 이어가기</span>
            </button>
          </nav>
        )}
        <p id="controls-hint" className="controls-hint">
          {session ? (
            <>
              <span>드래그 회전 · 우클릭 이동</span>
              <b>·</b>
              <span>휠 / 핀치 확대·축소</span>
            </>
          ) : (
            <>
              <span>
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> 이동
              </span>
              <b>·</b>
              <span>땅 클릭 / 터치</span>
              <b>·</b>
              <span>드래그 회전 · 우클릭 이동</span>
              <b>·</b>
              <span>휠 / 핀치 확대·축소</span>
            </>
          )}
        </p>
      </div>
      {!session && <Stick sim={sim} />}
      <output className="coordinates" aria-label="고양이 위치">
        {pose.x.toFixed(1)}, {pose.z.toFixed(1)}
      </output>
      {panel === "help" && (
        <Dialog title="섬에서 보내는 방법" close={() => setPanel(null)}>
          <p className="dialog-lead">
            우리 섬에서는 쉬고, 낚시섬에서는 집중해요.
          </p>
          <dl className="instructions">
            <div>
              <dt>걷기</dt>
              <dd>
                땅을 누르거나 WASD · 방향키로 화면 기준 방향으로 걸어요. 한글
                입력 상태에서도 같은 키를 써요. 휴대폰에서는 왼쪽 아래 발바닥을
                움직여요.
              </dd>
            </div>
            <div>
              <dt>둘러보기</dt>
              <dd>
                왼쪽 드래그로 회전하고, 우클릭 또는 Shift를 누른 채 드래그하면
                카메라만 이동해요. 휠·핀치·오른쪽 ± 버튼으로 확대·축소해요.
                휴대폰에서는 두 손가락을 함께 밀어 카메라를 옮겨요. 걷기
                시작하면 고양이를 다시 따라가고, R이나 시점 버튼으로 처음 구도로
                돌아와요.
              </dd>
            </div>
            <div>
              <dt>우리 섬</dt>
              <dd>
                마을회관 · 상점 · 모닥불 · 뗏목 부두를 걸어 다녀요. 인사 또는
                Space로 손을 흔들고, 쉬기를 누르면 자리에 앉아요.
              </dd>
            </div>
            <div>
              <dt>낚시섬</dt>
              <dd>
                낚시섬으로 가기를 누르면 뗏목을 타고 건너가요. 할 일을
                적고(선택) 연못가 빈 의자를 누르면 바로 앉아 낚시하며 집중해요.
              </dd>
            </div>
            <div>
              <dt>휴식과 종료</dt>
              <dd>
                휴식하기를 누르면 우리 섬 모닥불 곁에서 쉬고 시간이 멈춰요.
                의자는 맡아 두고, 집중 이어가기로 같은 의자에 돌아가요.
                종료하기는 1.5초 동안 길게 눌러요.
              </dd>
            </div>
            <div>
              <dt>섬의 소리</dt>
              <dd>
                산책할 때는 숲바람, 집중하고 쉴 때는 모닥불 소리가 들려요. 위쪽
                소리 버튼으로 끄고, 설정에서 볼륨을 바꿔요.
              </dd>
            </div>
          </dl>
          <div className="notice">
            체험용 섬이에요. 같은 주소로 들어온 이웃과 함께 걸을 수 있어요. 안내
            고양이·모카·구름은 산책 친구, 연못 가운데 작은 섬의 보리·까미·단비는
            함께 낚시하는 친구예요. 접속 인원에 포함되지 않고 물가 낚시 의자도
            사용하지 않아요. 낚아 올린 물고기는 보는 즐거움이라 따로 모이지
            않아요. 새로고침하거나 연결이 끊기면 현재 집중과 자리 예약이 끝나요.
            앱 계정·물고기·집중 기록에는 반영되지 않아요.
          </div>
          <button className="wide primary" onClick={() => setPanel(null)}>
            산책하러 가기
          </button>
        </Dialog>
      )}
      {!joined && (
        <Dialog
          title="섬에 온 걸 환영해요"
          dismissible={false}
          close={() => {}}
          className="welcome-dialog"
        >
          <p className="dialog-lead">
            이웃이 불러 줄 이름을 정하고,
            <br />
            나만의 고양이로 산책을 시작해요.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!validName(name.trim())) return;
              const next = { name: name.trim(), color };
              Object.assign(sim.actor, next);
              const saved = saveProfile(next);
              setName(next.name);
              sync();
              audio.unlock();
              setJoined(true);
              announce(
                saved
                  ? `${next.name}님, 섬에 오신 걸 환영해요.`
                  : "이번 방문은 이 이름으로 함께해요. 브라우저에서 이름을 기억할 수는 없어요.",
              );
            }}
          >
            <AppearanceFields
              name={name}
              color={color}
              onName={setName}
              onColor={setColor}
              welcome
            />
            <p className="welcome-note">
              이 브라우저에서 이름과 털색을 기억해요.
              <br />
              나중에 ‘내 고양이와 설정’에서 바꿀 수 있어요.
            </p>
            <button
              type="submit"
              className="wide primary"
              disabled={!validName(name.trim())}
            >
              이 이름으로 섬에 들어가기
            </button>
          </form>
        </Dialog>
      )}
      {joined && panel === "settings" && (
        <Dialog title="내 고양이" close={() => setPanel(null)}>
          <AppearanceFields
            name={name}
            color={color}
            onName={setName}
            onBlur={() => {
              const next = validName(name.trim())
                ? name.trim()
                : sim.actor.name;
              setName(next);
              sim.actor.name = next;
              saveProfile(sim.actor);
            }}
            onColor={(next) => {
              setColor(next);
              sim.actor.color = next;
              saveProfile(sim.actor);
            }}
          />
          <div className="audio-settings" data-audio-control>
            <div className="audio-heading">
              <span>섬의 소리</span>
              <button onClick={toggleSound}>
                {audio.state === "playing" || audio.state === "loading"
                  ? "소리 끄기"
                  : "소리 켜기"}
              </button>
            </div>
            <label htmlFor="island-volume">
              볼륨 {Math.round(audio.volume * 100)}%
            </label>
            <input
              id="island-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              value={Math.round(audio.volume * 100)}
              onChange={(e) => audio.setVolume(Number(e.target.value) / 100)}
            />
            <small>산책 · 숲바람 / 집중과 휴식 · 모닥불 ASMR</small>
          </div>
          <label className="toggle">
            <span>
              동작 줄이기
              <small>
                {systemReduced
                  ? "기기 설정이 켜져 있어요"
                  : "파도와 고양이의 반복 동작을 줄여요"}
              </small>
            </span>
            <input
              type="checkbox"
              checked={reduced}
              onChange={(e) => setReduced(e.target.checked)}
            />
          </label>
          <label className="toggle">
            <span>
              가벼운 화면<small>그림자와 화면 해상도를 낮춰요</small>
            </span>
            <input
              type="checkbox"
              checked={low}
              onChange={(e) => setLow(e.target.checked)}
            />
          </label>
          <button
            className="wide primary"
            onClick={() => {
              if (validName(name.trim())) sim.actor.name = name.trim();
              setName(sim.actor.name);
              saveProfile(sim.actor);
              setPanel(null);
            }}
          >
            이 모습으로 산책하기
          </button>
        </Dialog>
      )}
      {panel === "places" && (
        <Dialog title="발길이 닿는 곳" close={() => setPanel(null)}>
          <p className="dialog-lead">가고 싶은 곳을 골라 주세요.</p>
          <div className="destinations">
            {places.map((p) => (
              <button key={p.name} onClick={p.go} disabled={p.disabled}>
                <span>
                  <strong>{p.name}</strong>
                  <small>{p.desc}</small>
                </span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      {panel === "seats" && (
        <Dialog
          title={phase === "focusing" ? "자리 바꾸기" : "낚시 의자 고르기"}
          close={() => setPanel(null)}
          className="seat-dialog"
        >
          <p className="dialog-lead">
            {phase === "focusing" ? (
              "다른 의자로 옮겨도 집중 시간과 할 일은 그대로 이어져요."
            ) : (
              <>
                빈 의자를 누르면 바로 앉아 낚시를 시작해요.
                <br />할 일 · {subjectText(subject)}
              </>
            )}
          </p>
          <SeatPicker
            reservations={reservationBySeat}
            mySeatId={mySeatId}
            pendingSeatId={pendingSeatId}
            disabled={commandLocked}
            notice={seatNotice}
            onSelect={(id) => void selectSeat(id)}
          />
        </Dialog>
      )}
      {result && (
        <Dialog
          title="이번 집중 결과"
          close={() => {
            setResult(null);
            setResultError(null);
          }}
          className="result-dialog"
        >
          <FocusResultSummary result={result} error={resultError} />
          <div className="result-actions">
            <button
              className="primary"
              onClick={() => void focusAgain()}
              disabled={locked || busy}
            >
              <Icon name="fish" />
              다시 집중하기
            </button>
            <button
              onClick={() => void backHome()}
              disabled={locked || busy || (!online && island !== "home")}
            >
              <Icon name="home" />
              {crossing === "home" ? "건너가는 중…" : "우리 섬으로"}
            </button>
          </div>
        </Dialog>
      )}
      {interrupted && !lost && !failed && (
        <Dialog title="연결이 끊어졌어요" close={() => setInterrupted(false)}>
          <p className="dialog-lead">
            진행 중이던 집중을 멈추고 낚시 의자를 비웠어요. 다시 연결되면 우리
            섬에서 시작해요.
          </p>
          <button
            className="wide primary"
            onClick={() => setInterrupted(false)}
          >
            확인
          </button>
        </Dialog>
      )}
      {lost && (
        <Dialog
          title="섬 화면이 잠시 멈췄어요"
          close={() => {}}
          dismissible={false}
        >
          <p>
            {cancelledByGraphics
              ? "그래픽 연결이 끊어져 진행 중이던 집중을 취소했어요. "
              : "그래픽 연결이 끊어졌어요. "}
            다시 불러오면 우리 섬에서 이어서 산책할 수 있어요.
          </p>
          <button className="wide primary" onClick={() => location.reload()}>
            다시 불러오기
          </button>
        </Dialog>
      )}
    </main>
  );
}
