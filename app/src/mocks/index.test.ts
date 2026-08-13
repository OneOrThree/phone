import axios from 'axios';
import { enableApiMocks } from './index';

test('등록되지 않은 mock 요청은 실서버로 보내지 않고 로컬에서 실패한다', async () => {
  const instance = axios.create({ baseURL: 'https://should-not-be-called.invalid' });
  enableApiMocks(instance);

  await expect(instance.get('/api/v1/unhandled')).rejects.toMatchObject({
    code: 'ERR_MOCK_HANDLER_MISSING',
    message: '[mock] Unhandled GET /api/v1/unhandled',
  });
});
