import { describe, expect, it } from 'vitest';
import { makeFingerprint, normalizeForFingerprint, normalizeUrl } from './fingerprint.js';

describe('normalizeForFingerprint', () => {
  it('剔除数字、UUID、长十六进制,统一大小写与空白', () => {
    const a = normalizeForFingerprint(
      'Error at order 12345 for user 550e8400-e29b-41d4-a716-446655440000',
    );
    const b = normalizeForFingerprint(
      'error  at order 999 for USER 123e4567-e89b-42d3-a456-426614174000',
    );
    expect(a).toBe(b);
    expect(a).toContain('<n>');
    expect(a).toContain('<uuid>');
  });
});

describe('normalizeUrl', () => {
  it('去 query/hash,数字路径段归一化', () => {
    expect(normalizeUrl('https://a.com/order/123?t=99#x')).toBe('https://a.com/order/<n>');
  });

  it('同一资源不同 id 得到相同结果', () => {
    expect(normalizeUrl('https://a.com/u/1/posts/22')).toBe(
      normalizeUrl('https://a.com/u/8/posts/31?page=2'),
    );
  });

  it('非法 URL 不抛异常', () => {
    expect(() => normalizeUrl('not a url 42')).not.toThrow();
  });
});

describe('makeFingerprint', () => {
  it('同类问题不同数据 → 相同指纹', () => {
    const a = makeFingerprint('console-error', 'TypeError: x is undefined at line 10');
    const b = makeFingerprint('console-error', 'TypeError: x is undefined at line 99');
    expect(a).toBe(b);
  });

  it('不同检测器 → 不同指纹', () => {
    expect(makeFingerprint('a', 'same')).not.toBe(makeFingerprint('b', 'same'));
  });
});
