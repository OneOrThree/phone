export const intentKeyPool = (gen: () => string) => {
  const keys: Record<string, string> = {};
  const slot = (name: string, exactBody: string) => `${name}:${exactBody}`;
  return {
    key: (name: string, exactBody: string) => (keys[slot(name, exactBody)] ??= gen()),
    // 이미 키가 있다 = 같은 의도의 두 번째 이상 호출(응답 유실 재시도)
    has: (name: string, exactBody: string) => slot(name, exactBody) in keys,
    release: (name: string, exactBody: string) => {
      delete keys[slot(name, exactBody)];
    },
  };
};
