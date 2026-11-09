export type IconName =
  | "paw"
  | "walk"
  | "wave"
  | "fish"
  | "rest"
  | "reset"
  | "help"
  | "settings"
  | "close"
  | "people"
  | "sun"
  | "fire"
  | "sound"
  | "mute"
  | "arrow"
  | "raft"
  | "home"
  | "pause"
  | "play"
  | "seat"
  | "stop";
const paths: Record<IconName, React.ReactNode> = {
  fire: (
    <>
      <path d="M13 2c1 5-4 5-3 10-2-1-3-3-3-4-6 7-3 14 5 14 8 0 12-10 5-15 0 3-2 4-2 4s2-5-2-9Z" />
      <path d="M11 15c-3 3-1 6 2 6s4-3 1-6c0 2-2 2-2 2Z" />
    </>
  ),
  sound: (
    <>
      <path d="M3 9h4l5-4v14l-5-4H3Zm13-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16" />
    </>
  ),
  mute: (
    <>
      <path d="M3 9h4l5-4v14l-5-4H3Zm13 0 6 6m0-6-6 6" />
    </>
  ),
  paw: (
    <>
      <ellipse cx="12" cy="15.5" rx="5.3" ry="4" />
      <ellipse cx="5.5" cy="9" rx="2" ry="2.6" />
      <ellipse cx="10" cy="5.7" rx="1.8" ry="2.4" />
      <ellipse cx="15" cy="5.7" rx="1.8" ry="2.4" />
      <ellipse cx="19" cy="10" rx="1.8" ry="2.4" />
    </>
  ),
  walk: (
    <>
      <path d="m9 21 2-7-3-3 2-6 4 2 3 4h3M4 10l4-2M11 14l5 3v4" />
      <circle cx="13" cy="3" r="1.5" />
    </>
  ),
  wave: (
    <>
      <path d="M8 12 5 6c-1-2-3-1-2 1l4 10c3 7 12 5 13-2l1-7c0-2-3-2-3 0l-1 4V4c0-2-3-2-3 0v7L12 3c-.5-2-3-1.5-2 .5l1 8-4-7" />
    </>
  ),
  fish: (
    <>
      <path d="M3 12c5-8 12-8 16 0-4 8-11 8-16 0Zm16 0 3-4v8l-3-4Z" />
      <circle cx="7" cy="11" r=".7" />
      <path d="m10 6 4-3v3" />
    </>
  ),
  rest: (
    <>
      <path d="M7 3v7m5-7v7m5-7v7M4 12h16v4H4zm2 4v5m12-5v5" />
    </>
  ),
  reset: (
    <>
      <path d="M4 8a9 9 0 1 1-1 8M4 3v5h5" />
      <path d="m12 8 4 4-4 4-4-4Z" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v1" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="16" cy="17" r="3" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  arrow: <path d="m9 5 7 7-7 7" />,
  raft: (
    <>
      <path d="M3 16h18l-2 4H5Z" />
      <path d="M12 16V3l6 9h-6" />
      <path d="M2 21c2 1 4 1 6 0s4-1 6 0 4 1 6 0" />
    </>
  ),
  home: (
    <>
      <path d="m3 11 9-7 9 7" />
      <path d="M5 10v10h14V10M10 20v-6h4v6" />
    </>
  ),
  pause: <path d="M9 5v14m6-14v14" />,
  play: <path d="M8 5v14l11-7Z" />,
  seat: (
    <>
      <path d="M7 3h10v8H7Z" />
      <path d="M5 11h14v3H5Zm2 3v7m10-7v7" />
    </>
  ),
  stop: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h6v6H9Z" />
    </>
  ),
};
export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
