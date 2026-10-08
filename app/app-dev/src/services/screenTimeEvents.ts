const listeners = new Set<() => void>();

/** PUT 이후에도 통계·보상 값은 재조회한 서버 응답을 사용한다. */
export function subscribeScreenTimeObservations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function screenTimeObservationReported() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* 화면 구독 실패는 성공한 보고를 재시도하게 만들지 않는다. */
    }
  });
}
