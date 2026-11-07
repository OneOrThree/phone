import {
  primitiveTokens,
  semanticTokens,
} from "../../app-dev/src/design-system/tokens";
export const ui = semanticTokens.color;
// 자연물 재질만 3D 장면 전용 팔레트를 쓰고 UI는 앱 토큰을 그대로 따른다.
export const art = {
  ...primitiveTokens.color,
  ocean: "#8FCCD5",
  shallows: "#BBE1DC",
  foam: "#EAF5DF",
  grass: "#C1D69A",
  grassLight: "#D5E4AC",
  leaf: "#8EBA83",
  leafLight: "#ADCC87",
  sand: "#EEDBB3",
  sandSide: "#D8C49E",
  path: "#EAD5AC",
  stone: "#A4B4AE",
  roof: "#DC8D89",
  roofDark: "#B96868",
  timber: "#AE8464",
  timberDark: "#765847",
  peach: "#EFBC94",
  gray: "#9EA8B0",
  black: "#53535B",
  whiteCat: "#F6F3E7",
  brownCat: "#BA9379",
  skyTop: "#DFEEE5",
};
export const coats = {
  cream: art.cream,
  peach: art.peach,
  gray: art.gray,
  black: art.black,
  white: art.whiteCat,
  brown: art.brownCat,
};
export function installTokens() {
  const root = document.documentElement;
  Object.entries(ui).forEach(([key, value]) =>
    root.style.setProperty(`--${key}`, value),
  );
  Object.entries(primitiveTokens.space).forEach(([key, value]) =>
    root.style.setProperty(`--s${key}`, `${value}px`),
  );
}
