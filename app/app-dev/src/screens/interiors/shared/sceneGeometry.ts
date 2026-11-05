import { artSize } from '../assets';

// 2:3 배경 장면을 화면에 cover로 깔고 세로 38% 지점에 맞춘다 (세로 화면은 높이에 딱 맞아 위아래 여백이 없다)
export const interiorScene = (width: number, height: number) => {
  const w = Math.max(width, (height * artSize.background[0]) / artSize.background[1]),
    h = (w * artSize.background[1]) / artSize.background[0];
  return { left: (width - w) / 2, top: (height - h) * 0.38, width: w, height: h };
};

// 게시판 장면은 원본 비율을 덮도록 맞춘다. 폭이 배경 비율보다 넓으면 세로로 탐색한다.
export const boardScene = (width: number, height: number) => {
  if (width / height > artSize.background[0] / artSize.background[1])
    return {
      left: 0,
      top: 0,
      width,
      height: (width * artSize.background[1]) / artSize.background[0],
    };
  const sceneWidth = (height * artSize.background[0]) / artSize.background[1];
  return { left: (width - sceneWidth) / 2, top: 0, width: sceneWidth, height };
};
