import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTrustedIp } from './rateLimit';

test('localhost IPv4는 신뢰', () => {
  assert.equal(isTrustedIp('127.0.0.1'), true);
});

test('localhost IPv6(::1)는 신뢰', () => {
  assert.equal(isTrustedIp('::1'), true);
});

test('IPv6 매핑 localhost(::ffff:127.0.0.1)는 신뢰', () => {
  assert.equal(isTrustedIp('::ffff:127.0.0.1'), true);
});

test('사설 오버레이망 CGNAT 100.64.x는 신뢰', () => {
  assert.equal(isTrustedIp('100.64.0.1'), true);
});

test('사설 오버레이망 CGNAT 상단 100.127.x는 신뢰', () => {
  assert.equal(isTrustedIp('100.127.255.255'), true);
});

test('100.63.x(CGNAT 경계 밖)는 비신뢰', () => {
  assert.equal(isTrustedIp('100.63.255.255'), false);
});

test('100.128.x(CGNAT 경계 밖)는 비신뢰', () => {
  assert.equal(isTrustedIp('100.128.0.1'), false);
});

test('공인 IP는 비신뢰', () => {
  assert.equal(isTrustedIp('8.8.8.8'), false);
});

test('undefined는 비신뢰', () => {
  assert.equal(isTrustedIp(undefined), false);
});
