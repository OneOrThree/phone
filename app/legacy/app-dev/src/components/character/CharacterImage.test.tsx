// CharacterImage — variant별 에셋 매핑과 testID 전달.
//
// variant를 늘릴 때 SOURCES 키와 에셋 파일이 어긋나면(오타·복붙) 화면엔 "그럴듯한 다른 캐릭터"가
// 떠서 눈으로는 잘 안 잡힌다. 그래서 require() 참조 동일성으로 못 박는다.
import { render, screen } from '@testing-library/react-native';
import { CharacterImage, type CharacterVariant } from './CharacterImage';

describe('CharacterImage', () => {
  it.each<[CharacterVariant, number]>([
    ['default', require('@/assets/character.png')],
    ['study', require('@/assets/character_study.png')],
    ['happy', require('@/assets/character_happy.png')],
    ['hi', require('@/assets/character_hi.png')],
    ['sensitive', require('@/assets/character_sensitive.png')],
  ])('variant=%s는 대응하는 에셋을 그린다', async (variant, asset) => {
    await render(<CharacterImage size={100} variant={variant} testID="char" />);
    expect(screen.getByTestId('char').props.source).toBe(asset);
  });

  it('variant를 주지 않으면 default 에셋이다', async () => {
    await render(<CharacterImage size={100} testID="char" />);
    expect(screen.getByTestId('char').props.source).toBe(require('@/assets/character.png'));
  });

  // ⚠️ 커스텀 누끼가 있으면 표정(variant)은 통째로 무시된다 — 구현상 한계이자 계약이다.
  //    이게 바뀌면 "커스텀 캐릭터는 표정 전환 불가"라는 전제로 쓰인 화면들이 함께 흔들린다.
  it('sourceUri가 있으면 variant를 무시하고 그 URI를 그린다', async () => {
    await render(
      <CharacterImage size={100} variant="happy" sourceUri="file:///cutout.png" testID="char" />,
    );
    expect(screen.getByTestId('char').props.source).toEqual({ uri: 'file:///cutout.png' });
  });

  it('testID를 주지 않으면 붙지 않는다 — 기존 호출부에 영향 없음', async () => {
    const view = await render(<CharacterImage size={100} />);
    expect(view.toJSON()).toBeTruthy();
    expect(screen.queryByTestId('char')).toBeNull();
  });
});
