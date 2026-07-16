import { describe, expect, it } from 'vitest';
import type { Signal } from '@testpilot/shared';
import { logcatDetector } from './logcat.js';

const NOW = 1_752_000_000_000;

const logcat = (level: 'fatal' | 'anr' | 'error', message: string, pkg = 'com.demo.app'): Signal => ({
  kind: 'logcat',
  level,
  tag: level === 'anr' ? 'ActivityManager' : 'AndroidRuntime',
  message,
  pkg,
  at: NOW,
});

describe('logcatDetector', () => {
  it('闪退(fatal)→ Critical,标题含异常类名', () => {
    const f = logcatDetector.onSignal(
      logcat('fatal', 'FATAL EXCEPTION: main java.lang.NullPointerException at MainActivity.java:42'),
    );
    expect(f?.severity).toBe('critical');
    expect(f?.title).toContain('NullPointerException');
    expect(f?.fingerprint).toMatch(/^logcat:/);
  });

  it('同类崩溃不同行号 → 相同指纹(去重)', () => {
    const a = logcatDetector.onSignal(logcat('fatal', 'FATAL EXCEPTION: IllegalStateException at A.java:10'));
    const b = logcatDetector.onSignal(logcat('fatal', 'FATAL EXCEPTION: IllegalStateException at A.java:99'));
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it('不同应用的同类崩溃 → 不同指纹', () => {
    const a = logcatDetector.onSignal(logcat('fatal', 'FATAL EXCEPTION: X', 'com.a'));
    const b = logcatDetector.onSignal(logcat('fatal', 'FATAL EXCEPTION: X', 'com.b'));
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });

  it('ANR → High', () => {
    const f = logcatDetector.onSignal(logcat('anr', 'ANR in com.demo.app (com.demo.app/.MainActivity)'));
    expect(f?.severity).toBe('high');
    expect(f?.title).toContain('无响应');
  });

  it('非 logcat 信号忽略', () => {
    expect(
      logcatDetector.onSignal({ kind: 'console', level: 'error', message: 'x', url: 'u', at: NOW }),
    ).toBeNull();
  });
});
