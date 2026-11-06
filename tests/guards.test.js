import { describe, it, expect, vi, beforeEach } from 'vitest';

// Estado falso de dueños e instancias existentes; los mocks lo leen.
const owners = new Map();
const existing = new Set();

vi.mock('../src/accounts.js', () => ({
  getInstanceOwner: (name) => owners.get(name) ?? null,
  assignInstance: (name, id) => { if (!owners.has(name)) owners.set(name, id); },
  findByApiKey: () => null,
  registerAccount: vi.fn(),
  loginAccount: vi.fn(),
}));
vi.mock('../src/manager.js', () => ({
  instanceExists: (name) => existing.has(name),
}));

const { requireOwnership, requireOwnershipOrClaim } = await import('../src/utils/guards.js');
const { registrationOpen } = await import('../src/routes/auth.js');

function createMocks({ name, account = null, isAdmin = false }) {
  const req = { params: { name }, account, isAdmin };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

const alice = { id: 1, email: 'alice@example.com' };
const bob = { id: 2, email: 'bob@example.com' };

beforeEach(() => {
  owners.clear();
  existing.clear();
});

describe('requireOwnership', () => {
  it('lets the owner through', () => {
    owners.set('ventas', alice.id);
    const { req, res, next } = createMocks({ name: 'ventas', account: alice });
    requireOwnership(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects another account', () => {
    owners.set('ventas', alice.id);
    const { req, res, next } = createMocks({ name: 'ventas', account: bob });
    requireOwnership(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects accounts on an instance with no owner', () => {
    const { req, res, next } = createMocks({ name: 'admin-num', account: bob });
    requireOwnership(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets the admin through on any instance', () => {
    owners.set('ventas', alice.id);
    const { req, res, next } = createMocks({ name: 'ventas', isAdmin: true });
    requireOwnership(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe('requireOwnershipOrClaim', () => {
  it('claims a free name for the account', () => {
    const { req, res, next } = createMocks({ name: 'nueva', account: alice });
    requireOwnershipOrClaim(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(owners.get('nueva')).toBe(alice.id);
  });

  it('does not let an account claim an existing orphan instance', () => {
    existing.add('admin-num');
    const { req, res, next } = createMocks({ name: 'admin-num', account: bob });
    requireOwnershipOrClaim(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(owners.has('admin-num')).toBe(false);
  });

  it('gives a name to the first account only', () => {
    const first = createMocks({ name: 'nueva', account: alice });
    requireOwnershipOrClaim(first.req, first.res, first.next);
    const second = createMocks({ name: 'nueva', account: bob });
    requireOwnershipOrClaim(second.req, second.res, second.next);
    expect(first.next).toHaveBeenCalled();
    expect(second.res.status).toHaveBeenCalledWith(403);
  });

  it('does not assign an owner when the admin connects', () => {
    const { req, res, next } = createMocks({ name: 'nueva', isAdmin: true });
    requireOwnershipOrClaim(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(owners.has('nueva')).toBe(false);
  });
});

describe('registrationOpen', () => {
  it('is open by default', () => {
    delete process.env.ALLOW_REGISTRATION;
    expect(registrationOpen()).toBe(true);
  });

  it('closes with ALLOW_REGISTRATION=false', () => {
    process.env.ALLOW_REGISTRATION = 'false';
    expect(registrationOpen()).toBe(false);
    delete process.env.ALLOW_REGISTRATION;
  });
});
