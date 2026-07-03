export const T = {
  // paper
  paper: '#FFFFFF',
  paperDark: '#F5F5F5',
  paperLine: '#E0E0E0',

  // ink
  ink: '#111111',
  inkMed: '#666666',
  inkLight: '#AAAAAA',

  // accents (monochrome)
  yellow: '#E8E8E8',
  yellowDark: '#CCCCCC',
  coral: '#C0C0C0',
  coralDark: '#999999',
  mint: '#E0E0E0',
  mintDark: '#AAAAAA',
  sky: '#E4E4E4',
  skyDark: '#BBBBBB',
  lavender: '#E8E8E8',
  lavenderDark: '#BBBBBB',

  // 실패/경고 표시용 (모노크롬 팔레트와 별도)
  danger: '#D9362F',
};

export function inkBox(bg = T.paper) {
  return {
    backgroundColor: bg,
    borderWidth: 1.5,
    borderColor: T.ink,
    borderRadius: 8,
  };
}
