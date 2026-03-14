import { describe, it, expect } from 'vitest';
import { normalizeJid, validatePhoneOrJid } from '../src/utils/jid.js';

describe('normalizeJid', () => {
  it('adds @s.whatsapp.net to plain numbers', () => {
    expect(normalizeJid('5491155551234')).toBe('5491155551234@s.whatsapp.net');
  });

  it('passes through full JIDs unchanged', () => {
    expect(normalizeJid('5491155551234@s.whatsapp.net')).toBe('5491155551234@s.whatsapp.net');
  });

  it('passes through group JIDs unchanged', () => {
    expect(normalizeJid('120363012345678901@g.us')).toBe('120363012345678901@g.us');
  });

  it('strips spaces and formatting characters', () => {
    expect(normalizeJid('+54 911 5555-1234')).toBe('5491155551234@s.whatsapp.net');
  });
});

describe('validatePhoneOrJid', () => {
  it('accepts valid phone numbers (7-15 digits)', () => {
    expect(validatePhoneOrJid('5491155551234')).toBe(true);
    expect(validatePhoneOrJid('1234567')).toBe(true);
  });

  it('rejects too short numbers', () => {
    expect(validatePhoneOrJid('123456')).toBe(false);
  });

  it('rejects too long numbers', () => {
    expect(validatePhoneOrJid('1234567890123456')).toBe(false);
  });

  it('accepts valid individual JIDs', () => {
    expect(validatePhoneOrJid('5491155551234@s.whatsapp.net')).toBe(true);
  });

  it('accepts valid group JIDs', () => {
    expect(validatePhoneOrJid('120363012345678901@g.us')).toBe(true);
  });

  it('rejects invalid JID domains', () => {
    expect(validatePhoneOrJid('1234@invalid.domain')).toBe(false);
  });

  it('accepts numbers with formatting characters', () => {
    expect(validatePhoneOrJid('+54 911 5555-1234')).toBe(true);
  });
});
