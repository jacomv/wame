import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/manager.js', () => ({ instanceExists: vi.fn(() => false) }));
vi.mock('../src/accounts.js', () => ({
  assignInstance: vi.fn(),
  getInstanceOwner: vi.fn(),
}));
const { requireOwnership, requireOwnershipOrClaim } = await import('../src/utils/guards.js');
const { assignInstance, getInstanceOwner } = await import('../src/accounts.js');
const { instanceExists } = await import('../src/manager.js');

function run(guard, accountId = 1, isAdmin = false) {
  const req = { params: { name: 'test' }, account: { id: accountId }, isAdmin };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  guard(req, res, next);
  return { res, next };
}

describe('instance ownership isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInstanceOwner).mockReturnValue(1);
    vi.mocked(instanceExists).mockReturnValue(false);
  });

  it('allows the owner', () => {
    expect(run(requireOwnership, 1).next).toHaveBeenCalledOnce();
  });

  it('rejects other accounts', () => {
    const { res, next } = run(requireOwnership, 2);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects unowned legacy instances for normal accounts', () => {
    vi.mocked(getInstanceOwner).mockReturnValue(null);
    expect(run(requireOwnership, 1).res.status).toHaveBeenCalledWith(403);
  });

  it('allows admin access', () => {
    expect(run(requireOwnership, 2, true).next).toHaveBeenCalledOnce();
  });

  it('does not claim an existing legacy instance', () => {
    vi.mocked(getInstanceOwner).mockReturnValue(null);
    vi.mocked(instanceExists).mockReturnValue(true);
    const { res } = run(requireOwnershipOrClaim);
    expect(assignInstance).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('claims a new instance only for the requesting account', () => {
    vi.mocked(getInstanceOwner).mockReturnValueOnce(null).mockReturnValueOnce(1);
    const { next } = run(requireOwnershipOrClaim);
    expect(assignInstance).toHaveBeenCalledWith('test', 1);
    expect(next).toHaveBeenCalledOnce();
  });
});
