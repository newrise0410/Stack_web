import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as portone from '../src/services/portoneService.js';

function jsonRes(body, status = 200) {
  return { status, json: async () => body };
}
const TOKEN_RES = jsonRes({ code: 0, message: null, response: { access_token: 'tok-1', expired_at: Math.floor(Date.now() / 1000) + 1800, now: Math.floor(Date.now() / 1000) } });

describe('portoneService', () => {
  let fetchMock;
  beforeEach(() => {
    portone._resetTokenCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('getPayment — 토큰 발급 후 Authorization 원문으로 조회, response를 반환', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 0, message: null, response: { imp_uid: 'imp_1', status: 'paid', amount: 13000 } }));
    const pmt = await portone.getPayment('imp_1');
    expect(pmt.amount).toBe(13000);
    const [, opts] = fetchMock.mock.calls[1];
    expect(opts.headers.Authorization).toBe('tok-1'); // Bearer 접두사 없음
  });

  it('토큰은 만료 전 캐시된다(2회 호출에 getToken 1회)', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 0, response: { imp_uid: 'a' } }))
      .mockResolvedValueOnce(jsonRes({ code: 0, response: { imp_uid: 'b' } }));
    await portone.getPayment('a');
    await portone.getPayment('b');
    const tokenCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/users/getToken'));
    expect(tokenCalls.length).toBe(1);
  });

  it('code!==0이면 PortoneError(시크릿 미포함)', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 1, message: '존재하지 않는 결제정보입니다.', response: null }));
    const err = await portone.getPayment('imp_x').catch((e) => e);
    expect(err).toBeInstanceOf(portone.PortoneError);
    expect(JSON.stringify(err)).not.toContain('test-imp-secret');
  });

  it('5xx/네트워크 오류는 PortoneUnknownError', async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_RES).mockResolvedValueOnce(jsonRes({}, 502));
    await expect(portone.getPayment('imp_y')).rejects.toBeInstanceOf(portone.PortoneUnknownError);
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(portone.getPayment('imp_z')).rejects.toBeInstanceOf(portone.PortoneUnknownError);
  });

  it('findPayment — 미존재(code!==0)면 null', async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_RES)
      .mockResolvedValueOnce(jsonRes({ code: 1, message: '없음', response: null }));
    expect(await portone.findPayment('20260717-1')).toBe(null);
  });
});
