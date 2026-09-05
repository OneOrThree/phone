// 기존 계정 판별(GROMO-1637) — 계정 존재(isNewUser=false)와 프로필 등록(닉네임) 둘 다 필요.
import { isExistingAccount } from './types';
import type { LoginResult } from '@/types/api';

const base: LoginResult = { accessToken: 'token' };

describe('isExistingAccount', () => {
  it('재로그인 + 닉네임 등록 완료면 기존 계정', () => {
    expect(isExistingAccount({ ...base, isNewUser: false, nickname: '그로몬' })).toBe(true);
  });

  it('신규 계정(isNewUser=true)은 기존 계정이 아니다', () => {
    expect(isExistingAccount({ ...base, isNewUser: true })).toBe(false);
  });

  it('유령 계정(재로그인이지만 닉네임 미등록)은 기존 계정이 아니다 — 남은 온보딩을 밟는다', () => {
    expect(isExistingAccount({ ...base, isNewUser: false })).toBe(false);
  });

  it('빈 문자열·공백 닉네임 레거시(GROMO-1215 이전)도 미등록으로 본다', () => {
    expect(isExistingAccount({ ...base, isNewUser: false, nickname: '' })).toBe(false);
    expect(isExistingAccount({ ...base, isNewUser: false, nickname: '  ' })).toBe(false);
  });

  it('isNewUser 미전달(undefined)은 기존 계정이 아니다', () => {
    expect(isExistingAccount({ ...base, nickname: '그로몬' })).toBe(false);
  });
});
