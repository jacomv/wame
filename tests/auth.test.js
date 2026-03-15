import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireApiKey } from '../src/auth.js';

function createMocks(apiKeyHeader) {
  const req = { headers: { 'x-api-key': apiKeyHeader } };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('requireApiKey', () => {
  beforeEach(() => {
    process.env.API_KEY = 'test-secret-key';
  });

  it('calls next() with valid API key', () => {
    const { req, res, next } = createMocks('test-secret-key');
    requireApiKey(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 with invalid API key', () => {
    const { req, res, next } = createMocks('wrong-key');
    requireApiKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no API key is provided', () => {
    const { req, res, next } = createMocks(undefined);
    requireApiKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 with empty API key', () => {
    const { req, res, next } = createMocks('');
    requireApiKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
