export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function request<T>(path: string, options: {
  method?: string; body?: unknown; csrfToken?: string; signal?: AbortSignal;
} = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    signal: options.signal,
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const content = await response.text();
  let data: unknown;
  try { data = content ? JSON.parse(content) : null; }
  catch { throw new ApiError('서버 응답을 읽을 수 없습니다. 연결 상태를 확인해 주세요.', response.status); }
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? String(data.error) : `요청에 실패했습니다 (${response.status}).`;
    throw new ApiError(error, response.status);
  }
  return data as T;
}
