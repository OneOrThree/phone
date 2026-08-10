// AnimatedCharacter — '동작 줄이기' 게이트와 셀렉터 전달.
//
// ⚠️ 호흡의 중간 프레임·주기·이징은 단언하지 않는다(컨트랙트 §8). 워클릿은 jest에서 목이라
//    실제로 돌지 않는다. 여기서 잠그는 건 "reduce면 애니메이션 스타일이 아예 안 붙는다"와
//    "testID가 래퍼에 전달된다" 두 가지뿐이다.
import { render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import { AnimatedCharacter } from './AnimatedCharacter';

let mockReduce = false;
jest.mock('@/hooks/useReduceMotion', () => ({
  useReduceMotion: () => mockReduce,
  useReduceMotionReady: () => true,
}));

beforeEach(() => {
  mockReduce = false;
});

describe('AnimatedCharacter', () => {
  it('testID를 래퍼에 전달한다 — 캐릭터를 통째로 집을 수 있다', async () => {
    await render(<AnimatedCharacter size={216} testID="home.character" />);
    expect(screen.getByTestId('home.character')).toBeTruthy();
  });

  it('reduce=false면 호흡 transform이 붙는다', async () => {
    await render(<AnimatedCharacter size={216} testID="home.character" />);
    const style = StyleSheet.flatten(screen.getByTestId('home.character').props.style);
    // 값(중간 프레임)이 아니라 "transform 채널이 살아 있다"만 본다.
    expect(style.transform).toBeDefined();
    expect(style.transformOrigin).toBe('50% 100%');
  });

  it('reduce=true면 애니메이션 스타일을 아예 붙이지 않는다', async () => {
    mockReduce = true;
    await render(<AnimatedCharacter size={216} testID="home.character" />);
    const style = StyleSheet.flatten(screen.getByTestId('home.character').props.style);
    expect(style?.transform).toBeUndefined();
    expect(style?.transformOrigin).toBeUndefined();
  });

  it('variant·size를 CharacterImage로 내려보낸다', async () => {
    await render(<AnimatedCharacter size={216} variant="happy" testID="home.character" />);
    const image = screen.getByTestId('home.character').children[0];
    if (typeof image === 'string') throw new Error('캐릭터 이미지가 아니라 텍스트가 렌더됐다');
    expect(image.props.source).toBe(require('@/assets/character_happy.png'));
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({ width: 216, height: 216 });
  });

  // ⚠️ 이 슬롯이 없으면 집중 세션이 이 컴포넌트를 못 쓴다 — captureRef가 호흡 transform
  //    **안쪽**에 들어가 눌린 중간 프레임이 Live Activity에 구워지기 때문이다.
  //    래퍼가 캡처 ref의 부모가 되는 구조를 만들 수 있어야 한다(codex 리뷰).
  it('children을 주면 내부 CharacterImage 대신 그것을 호흡 래퍼 안에 그린다', async () => {
    await render(
      <AnimatedCharacter size={230} testID="focus.character">
        <View testID="focus.character.shot" />
      </AnimatedCharacter>,
    );
    const wrapper = screen.getByTestId('focus.character');
    // 캡처 대상이 호흡 래퍼의 **자식**이어야 한다(부모가 아니라)
    expect(screen.getByTestId('focus.character.shot')).toBeTruthy();
    expect(wrapper.children).toHaveLength(1);
    // children이 있으면 기본 CharacterImage는 그리지 않는다
    expect(screen.queryByTestId('focus.character.image')).toBeNull();
  });

  // ⚠️ 탭 네비게이터는 unmountOnBlur가 없어 다른 탭으로 가도 홈이 마운트된 채 남는다.
  //    active를 안 넘기면 보이지도 않는 캐릭터의 무한 루프가 앱 세션 내내 돈다(codex 리뷰).
  it('active=false면 호흡을 붙이지 않는다 — 포커스를 잃은 탭에서 루프가 남지 않게', async () => {
    await render(<AnimatedCharacter size={216} active={false} testID="home.character" />);
    const style = StyleSheet.flatten(screen.getByTestId('home.character').props.style);
    expect(style?.transform).toBeUndefined();
    expect(style?.transformOrigin).toBeUndefined();
  });
});
