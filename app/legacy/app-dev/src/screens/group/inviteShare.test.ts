import { buildInviteShareMessage } from './inviteShare';

const URL = 'https://link.oneorthree.world/l/abc123?g=g-1';

describe('buildInviteShareMessage', () => {
  it('그룹명과 서버 발급 url 을 한 줄씩 담는다', () => {
    expect(buildInviteShareMessage('아침 6시 집중방', URL)).toBe(
      `아침 6시 집중방 그룹에 초대했어요! 같이 집중해요 ⭐️\n${URL}`,
    );
  });

  it('그룹명의 줄바꿈을 눕혀 가짜 링크 줄을 만들지 못하게 한다', () => {
    const spoofed = '스터디\nhttps://evil.example.com 여기로 들어오세요';

    const message = buildInviteShareMessage(spoofed, URL);

    // 본문의 개행은 url 앞 하나뿐이어야 한다 — 이름이 줄을 더 만들면 그 줄이 링크처럼 보인다.
    expect(message.split('\n')).toHaveLength(2);
    expect(message).toBe(
      `스터디 https://evil.example.com 여기로 들어오세요 그룹에 초대했어요! 같이 집중해요 ⭐️\n${URL}`,
    );
  });

  it('그룹명 앞뒤 공백과 연속 공백을 정리한다', () => {
    expect(buildInviteShareMessage('  아침   집중방 \t', URL)).toBe(
      `아침 집중방 그룹에 초대했어요! 같이 집중해요 ⭐️\n${URL}`,
    );
  });
});
