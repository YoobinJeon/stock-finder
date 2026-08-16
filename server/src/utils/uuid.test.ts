import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuid, UUID_RE } from './uuid';

test('표준 UUID는 통과', () => {
  assert.equal(isUuid('3f2a1b6c-0d4e-4a91-8b2c-7e5f9a0d1c34'), true);
});

test('대문자 UUID도 통과 (Postgres가 받아들이는 형식)', () => {
  assert.equal(isUuid('3F2A1B6C-0D4E-4A91-8B2C-7E5F9A0D1C34'), true);
});

test('하이픈 없는 문자열은 거부', () => {
  assert.equal(isUuid('3f2a1b6c0d4e4a918b2c7e5f9a0d1c34'), false);
});

test('임의 문자열은 거부 — PG 22P02(500)로 새지 않아야 함', () => {
  assert.equal(isUuid('abc'), false);
});

test('SQL 조각처럼 보이는 입력도 거부', () => {
  assert.equal(isUuid("' OR 1=1--"), false);
});

test('길이가 한 자 모자라면 거부', () => {
  assert.equal(isUuid('3f2a1b6c-0d4e-4a91-8b2c-7e5f9a0d1c3'), false);
});

test('16진수가 아닌 문자가 섞이면 거부', () => {
  assert.equal(isUuid('3f2a1b6c-0d4e-4a91-8b2c-7e5f9a0d1cZZ'), false);
});

test('문자열이 아니면 거부', () => {
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(123), false);
});

test('UUID_RE는 전체 일치만 허용 (앞뒤 덧붙임 거부)', () => {
  assert.equal(UUID_RE.test('x3f2a1b6c-0d4e-4a91-8b2c-7e5f9a0d1c34'), false);
  assert.equal(UUID_RE.test('3f2a1b6c-0d4e-4a91-8b2c-7e5f9a0d1c34x'), false);
});
