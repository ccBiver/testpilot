import { describe, expect, it } from 'vitest';
import { checkGuardrail } from './guardrail.js';
import { isSameSite } from './web-executor.js';

describe('isSameSite', () => {
  it('子域视为同站,外域拒绝', () => {
    expect(isSameSite('https://account.shop.com/reg', 'https://www.shop.com/')).toBe(true);
    expect(isSameSite('https://www.shop.com/a', 'https://www.shop.com/b')).toBe(true);
    expect(isSameSite('https://t.me/xxx', 'https://www.shop.com/')).toBe(false);
    expect(isSameSite('not a url', 'https://www.shop.com/')).toBe(false);
  });
});

describe('checkGuardrail', () => {
  it('拦截资金与破坏性操作(中英文)', () => {
    expect(checkGuardrail('立即支付').allowed).toBe(false);
    expect(checkGuardrail('删除账号').allowed).toBe(false);
    expect(checkGuardrail('Checkout Now').allowed).toBe(false);
    expect(checkGuardrail('DELETE my data').allowed).toBe(false);
  });

  it('拦截时返回命中的词', () => {
    expect(checkGuardrail('确认提现').matchedWord).toBe('提现');
  });

  it('普通导航与浏览操作放行', () => {
    expect(checkGuardrail('查看详情').allowed).toBe(true);
    expect(checkGuardrail('关于我们').allowed).toBe(true);
    expect(checkGuardrail('下一页').allowed).toBe(true);
    expect(checkGuardrail('').allowed).toBe(true);
  });
});
