import { fireEvent, render, screen } from '@testing-library/react-native';
import { GroupCardEmojiPicker } from './GroupCardEmojiPicker';
import { GROUP_CARD_EMOJIS, GROUP_CARD_EMOJI_LABELS } from '../groupCardEmojiStore';

test('12개 아이콘은 raw emoji가 아닌 고정된 한국어 이름으로 식별한다', async () => {
  const onChange = jest.fn();
  await render(<GroupCardEmojiPicker value="🎯" onChange={onChange} />);

  for (const emoji of GROUP_CARD_EMOJIS) {
    expect(
      screen.getByLabelText(`카드 아이콘 ${GROUP_CARD_EMOJI_LABELS[emoji]}`),
    ).toBeOnTheScreen();
  }

  fireEvent.press(screen.getByLabelText('카드 아이콘 책'));
  expect(onChange).toHaveBeenCalledWith('📚');
});
