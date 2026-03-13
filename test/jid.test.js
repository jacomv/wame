import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeJid, validatePhoneOrJid } from '../src/utils/jid.js';

// ── normalizeJid ─────────────────────────────────────────────────

test('normalizeJid: plain number gets @s.whatsapp.net suffix', () => {
  assert.equal(normalizeJid('5215551234567'), '5215551234567@s.whatsapp.net');
});

test('normalizeJid: full JID passes through unchanged', () => {
  assert.equal(normalizeJid('5215551234567@s.whatsapp.net'), '5215551234567@s.whatsapp.net');
});

test('normalizeJid: group JID passes through unchanged', () => {
  assert.equal(normalizeJid('120363012345678901@g.us'), '120363012345678901@g.us');
});

test('normalizeJid: strips spaces, +, (), - from plain number', () => {
  assert.equal(normalizeJid('+52 (555) 123-4567'), '525551234567@s.whatsapp.net');
});

test('normalizeJid: trims whitespace from JID', () => {
  assert.equal(normalizeJid('  573001234567@s.whatsapp.net  '), '573001234567@s.whatsapp.net');
});

// ── validatePhoneOrJid ───────────────────────────────────────────

test('validatePhoneOrJid: valid 13-digit number', () => {
  assert.equal(validatePhoneOrJid('5215551234567'), true);
});

test('validatePhoneOrJid: valid 10-digit number', () => {
  assert.equal(validatePhoneOrJid('5551234567'), true);
});

test('validatePhoneOrJid: valid individual JID', () => {
  assert.equal(validatePhoneOrJid('5215551234567@s.whatsapp.net'), true);
});

test('validatePhoneOrJid: valid group JID', () => {
  assert.equal(validatePhoneOrJid('120363012345678901@g.us'), true);
});

test('validatePhoneOrJid: number with formatting is valid', () => {
  assert.equal(validatePhoneOrJid('+52 555 123 4567'), true);
});

test('validatePhoneOrJid: too short (6 digits) is invalid', () => {
  assert.equal(validatePhoneOrJid('123456'), false);
});

test('validatePhoneOrJid: letters in number are invalid', () => {
  assert.equal(validatePhoneOrJid('abc123'), false);
});

test('validatePhoneOrJid: unknown JID domain is invalid', () => {
  assert.equal(validatePhoneOrJid('521234@unknown.net'), false);
});
