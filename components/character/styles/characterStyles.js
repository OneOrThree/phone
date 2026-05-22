import { StyleSheet } from 'react-native';
import { T } from '../../theme';

export const INK = T.ink;
export const BW = 2.5;

export const s = StyleSheet.create({
  wrapper: {
    width: 120,
    height: 175,
    alignItems: 'center',
  },

  // Ears
  earLeft: {
    position: 'absolute', top: 0, left: 16,
    width: 28, height: 30, borderRadius: 14,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  earRight: {
    position: 'absolute', top: 0, right: 16,
    width: 28, height: 30, borderRadius: 14,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', justifyContent: 'center', zIndex: 1,
  },
  earInner: {
    width: 14, height: 18, borderRadius: 7,
    backgroundColor: '#FFB7C5',
    borderWidth: 1.5, borderColor: INK,
  },

  // Head
  head: {
    position: 'absolute', top: 14, left: 0, right: 0, height: 100,
    borderRadius: 50, backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    alignItems: 'center', paddingTop: 20, zIndex: 2,
  },

  // Eyes
  eyesRow: { flexDirection: 'row', gap: 20 },
  eye: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: '#FFF',
    borderWidth: 2, borderColor: INK,
    alignItems: 'center', justifyContent: 'center',
  },
  eyeSquint: { height: 14, borderRadius: 7, marginTop: 6 },
  pupil: {
    width: 16, height: 16, borderRadius: 8, backgroundColor: INK,
    alignItems: 'flex-end', justifyContent: 'flex-start', padding: 2,
  },
  pupilFlat: { height: 8, borderRadius: 4, width: 14 },
  shine: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#FFF' },
  eyeCrescent: {
    width: 22, height: 8, borderRadius: 4,
    backgroundColor: INK, marginTop: 4,
  },
  starEyeText: { fontSize: 13, color: T.yellowDark },

  // Glasses
  glassesRow: {
    position: 'absolute', top: 18,
    flexDirection: 'row', alignItems: 'center',
  },
  glassesFrame: {
    width: 30, height: 22, borderRadius: 8,
    borderWidth: 2, borderColor: T.inkMed, backgroundColor: 'transparent',
  },
  glassesBridge: { width: 8, height: 2.5, backgroundColor: T.inkMed },

  // Sweat
  sweat: {
    position: 'absolute', top: 14, right: 16,
    width: 8, height: 11, borderRadius: 4,
    borderBottomLeftRadius: 4, borderBottomRightRadius: 4,
    borderTopLeftRadius: 8, borderTopRightRadius: 0,
    backgroundColor: T.sky, borderWidth: 1.5, borderColor: INK,
    transform: [{ rotate: '15deg' }],
  },

  // Cheeks
  cheeksRow: { flexDirection: 'row', gap: 36, marginTop: 4 },
  cheek: {
    width: 20, height: 12, borderRadius: 10,
    backgroundColor: 'rgba(255, 120, 120, 0.25)',
  },

  // Nose
  nose: {
    width: 9, height: 6, borderRadius: 4,
    backgroundColor: '#FF8FAB',
    borderWidth: 1.5, borderColor: INK, marginTop: 2,
  },

  // Mouths
  mouth: {
    marginTop: 5, width: 22, height: 10,
    borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderRightWidth: 2.5, borderTopWidth: 0,
    borderBottomLeftRadius: 11, borderBottomRightRadius: 11, borderColor: INK,
  },
  mouthBig: {
    marginTop: 4, width: 30, height: 14,
    borderBottomWidth: 3, borderLeftWidth: 3, borderRightWidth: 3, borderTopWidth: 0,
    borderBottomLeftRadius: 15, borderBottomRightRadius: 15, borderColor: INK,
  },
  mouthFlat: { marginTop: 8, width: 18, height: 3, borderRadius: 2, backgroundColor: INK },
  mouthOpen: {
    marginTop: 5, width: 18, height: 12,
    borderRadius: 6, backgroundColor: INK,
    alignItems: 'center', justifyContent: 'center',
  },
  mouthTongueWrap: { alignItems: 'center' },
  tongue: {
    width: 12, height: 8, borderRadius: 6,
    backgroundColor: '#FF8FAB',
    borderWidth: 1.5, borderColor: INK,
    marginTop: -2,
  },

  // Body
  body: {
    position: 'absolute', top: 100, left: 18, right: 18, height: 62,
    borderRadius: 30, backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
    zIndex: 1, alignItems: 'center', justifyContent: 'center',
  },

  // Body items
  laptop: {
    width: 34, height: 24, borderRadius: 4,
    borderWidth: 2, borderColor: INK, backgroundColor: '#C8E6FF',
  },
  bookWrap: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  bookPage: {
    width: 18, height: 26, backgroundColor: '#FFFCF0',
    borderWidth: 1.5, borderColor: INK,
    borderRadius: 2, padding: 3, gap: 4,
  },
  bookSpine: { width: 4, height: 26, backgroundColor: T.coral, borderWidth: 1, borderColor: INK },
  bookLine: { height: 2, backgroundColor: T.inkLight, borderRadius: 1 },
  dbWrap: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  dbWeight: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: T.inkMed, borderWidth: 1.5, borderColor: INK,
  },
  dbBar: {
    width: 22, height: 6, backgroundColor: T.inkLight,
    borderWidth: 1.5, borderColor: INK,
  },
  paperWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  paper: {
    width: 26, height: 30, backgroundColor: '#FFFCF0',
    borderWidth: 1.5, borderColor: INK, borderRadius: 2,
    padding: 4, gap: 4,
  },
  paperLine: { height: 2, backgroundColor: T.sky, borderRadius: 1 },
  pencil: {
    width: 6, height: 28, borderRadius: 3,
    backgroundColor: T.yellow, borderWidth: 1.5, borderColor: INK,
    marginTop: 1,
  },
  auraWrap: { alignItems: 'center' },
  auraText: { fontSize: 22, color: T.mint },

  // Paws
  pawsRow: { position: 'absolute', bottom: 0, flexDirection: 'row', gap: 30, zIndex: 3 },
  pawsWide: { gap: 44 },
  paw: {
    width: 22, height: 16, borderRadius: 11,
    backgroundColor: '#FFF8E7',
    borderWidth: BW, borderColor: INK,
  },
});
