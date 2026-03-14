import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateInstanceName } from '../src/utils/jid.js';

function createMocks(params = {}) {
  const req = { params, body: {}, query: {} };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('validateInstanceName middleware', () => {
  it('accepts valid alphanumeric names', () => {
    const { req, res, next } = createMocks({ name: 'ventas-01' });
    validateInstanceName(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts underscores and hyphens', () => {
    const { req, res, next } = createMocks({ name: 'my_instance-2' });
    validateInstanceName(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects names with path traversal', () => {
    const { req, res, next } = createMocks({ name: '../etc/passwd' });
    validateInstanceName(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects names with spaces', () => {
    const { req, res, next } = createMocks({ name: 'my instance' });
    validateInstanceName(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects empty names', () => {
    const { req, res, next } = createMocks({ name: '' });
    validateInstanceName(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects names longer than 64 characters', () => {
    const { req, res, next } = createMocks({ name: 'a'.repeat(65) });
    validateInstanceName(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('accepts names at the 64 character limit', () => {
    const { req, res, next } = createMocks({ name: 'a'.repeat(64) });
    validateInstanceName(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
