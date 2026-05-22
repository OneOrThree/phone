export const T = {
  // paper
  paper: '#FAF7F0',
  paperDark: '#F0EAD8',
  paperLine: '#E8DFC8',

  // ink
  ink: '#1C1208',
  inkMed: '#6B4C2A',
  inkLight: '#C4A882',

  // accents
  yellow: '#FFE566',
  yellowDark: '#D4AD00',
  coral: '#FF7461',
  coralDark: '#C04A38',
  mint: '#5ECFA8',
  mintDark: '#2EA880',
  sky: '#6BBFEF',
  skyDark: '#3A8FC0',
  lavender: '#C5A9FF',
  lavenderDark: '#8A6ADA',
};

// Ink-shadow card style: thick bottom/right border = hand-drawn shadow
export function inkBox(bg = T.paper, rotate = '0deg') {
  return {
    backgroundColor: bg,
    borderWidth: 2.5,
    borderColor: T.ink,
    borderBottomWidth: 5,
    borderRightWidth: 5,
    borderTopLeftRadius: 13,
    borderTopRightRadius: 11,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 14,
    transform: [{ rotate }],
  };
}
