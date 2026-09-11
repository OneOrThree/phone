export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); }
}

export function fail(status: number, code: string): never { throw new ApiError(status, code); }

export async function respond(action: () => Promise<unknown>): Promise<Response> {
  try { return Response.json(await action(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) {
    if (error instanceof ApiError) return Response.json({ code: error.code, message: error.code }, { status: error.status });
    // 연결 문자열·원본 요청·토큰이 DB 오류에 섞일 수 있어 응답과 로그에 싣지 않는다.
    console.error('link_request_failed', error instanceof Error ? error.name : 'UnknownError');
    return Response.json({ code: 'LINK_UNAVAILABLE', message: '잠시 후 다시 시도해 주세요.' }, { status: 503 });
  }
}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_REQUEST');
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(400, 'INVALID_REQUEST');
  return value;
}

export function uuid(value: unknown): string {
  const result = text(value, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) fail(400, 'INVALID_UUID');
  return result.toLowerCase();
}

export function version(value: unknown): string {
  // Java long을 JSON number로 보내면 정밀도가 유실될 수 있으므로 큰 값은 문자열을 요구한다.
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) fail(400, 'INVALID_VERSION');
  const result = String(value);
  if (!/^\d{1,19}$/.test(result) || BigInt(result) > 9223372036854775807n) fail(400, 'INVALID_VERSION');
  return result;
}
