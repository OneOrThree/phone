/**
 * 콘솔 쓰기의 «논리 작업»과 멱등 키를 잇는다.
 *
 * <p>호출마다 새 키를 만들면, 알림 서버가 `test`·`resend` 를 커밋한 뒤 프록시 timeout 이나
 * 응답 유실이 생겼을 때 사용자의 재시도가 «새 명령» 으로 실행돼 운영 알림이 두 번 나간다.
 * 그래서 키는 작업 단위로 보존하고, 결과가 «확정» 됐을 때만 버린다.
 */
export type ConsoleOperation = { resource: string; environment: string; id: string; action?: string };

export function operationId(operation: ConsoleOperation): string {
  return [operation.resource, operation.environment, operation.id, operation.action ?? 'save']
    .map(part => encodeURIComponent(part)).join('|');
}

/** 콘솔 요청 실패 — `status` 가 null 이면 응답 자체를 받지 못한 것이다. */
export class ConsoleRequestError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'ConsoleRequestError';
    this.status = status;
  }
}

/**
 * 서버가 명령을 «평가하고 거절» 한 것이 확실한가.
 *
 * <p>확정이 아니면(응답 없음·5xx·timeout·429) 명령이 이미 커밋됐을 수 있으므로 키를 보존한다.
 */
export function outcomeSettled(status: number | null): boolean {
  if (status === null || status >= 500) return false;
  return status !== 408 && status !== 425 && status !== 429;
}

export class IdempotencyKeyring {
  private readonly keys = new Map<string, string>();
  private readonly mint: () => string;

  constructor(mint: () => string = () => crypto.randomUUID()) { this.mint = mint; }

  /** 같은 작업의 재시도는 같은 키를 받는다. 결과가 확정되면 키를 버려 다음 «새» 명령과 섞이지 않게 한다. */
  async run<T>(operation: ConsoleOperation, action: (key: string) => Promise<T>): Promise<T> {
    const id = operationId(operation);
    let key = this.keys.get(id);
    if (key === undefined) { key = this.mint(); this.keys.set(id, key); }
    try {
      const result = await action(key);
      this.keys.delete(id);
      return result;
    } catch (cause) {
      if (outcomeSettled(cause instanceof ConsoleRequestError ? cause.status : null)) this.keys.delete(id);
      throw cause;
    }
  }

  /** 테스트·진단용 — 해당 작업의 키가 재시도를 위해 남아 있는가. */
  retained(operation: ConsoleOperation): boolean { return this.keys.has(operationId(operation)); }
}
