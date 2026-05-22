import { StyleSheet } from 'react-native';
import { T } from '../../theme';
import { INK, BW } from './characterStyles';

export const c = StyleSheet.create({
  // 팔
  armLeft:  { position: 'absolute', top: 105, left: 13,  width: 11, height: 26, zIndex: 4 },
  armRight: { position: 'absolute', top: 105, left: 95,  width: 11, height: 26, zIndex: 4 },
  arm: {
    position: 'absolute',
    bottom: 0, left: 0,
    width: 11, height: 26,
    backgroundColor: '#FFF8E7',
    borderRadius: 6,
    borderWidth: BW, borderColor: INK,
  },
  hand: {
    position: 'absolute',
    bottom: -5, left: 1,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: '#FFF8E7',
    borderWidth: BW - 0.5, borderColor: INK,
  },

  // 베레모
  beret: {
    position: 'absolute', top: -2, zIndex: 5,
    alignItems: 'center',
  },
  beretTop: {
    width: 64, height: 18, borderRadius: 32,
    backgroundColor: '#8B3A3A',
    borderWidth: BW, borderColor: INK,
  },

  // 포니테일
  ponytail: {
    position: 'absolute', top: 24, right: 6, zIndex: 1,
    width: 10, height: 48, borderRadius: 5,
    backgroundColor: '#7B4A1E',
    borderWidth: 1.5, borderColor: INK,
    transform: [{ rotate: '12deg' }],
  },

  // 별 귀걸이
  earring: {
    position: 'absolute', top: 46, left: 4, zIndex: 5,
    fontSize: 10, color: T.yellowDark,
  },

  // 후드티
  bodyHoodie: { backgroundColor: '#7EB8D4' },
  hoodieString: {
    position: 'absolute', top: 4,
    width: 4, height: 14, borderRadius: 2,
    backgroundColor: '#5A9AB8', borderWidth: 1, borderColor: INK,
  },

  // 청바지
  jeans: {
    position: 'absolute', bottom: 12, zIndex: 2,
    width: 76, height: 18, borderRadius: 4,
    backgroundColor: '#3A5A8C',
    borderWidth: BW, borderColor: INK,
    borderBottomWidth: 0,
  },
});
