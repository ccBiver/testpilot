import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeDropPath, readDoc } from './read-doc.js';

describe('normalizeDropPath', () => {
  it('去掉单/双引号包裹', () => {
    expect(normalizeDropPath("'/a/b c.pdf'")).toBe('/a/b c.pdf');
    expect(normalizeDropPath('"/a/b.md"')).toBe('/a/b.md');
  });

  it('还原拖拽转义的空格', () => {
    expect(normalizeDropPath('/Users/x/my\\ doc.pdf')).toBe('/Users/x/my doc.pdf');
  });

  it('展开 ~', () => {
    expect(normalizeDropPath('~/docs/a.md')).toBe(path.join(os.homedir(), 'docs/a.md'));
  });

  it('普通路径原样', () => {
    expect(normalizeDropPath('  requirements.md ')).toBe('requirements.md');
  });
});

describe('readDoc', () => {
  it('读 .md / .txt 纯文本', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-doc-'));
    const f = path.join(dir, 'prd.md');
    await writeFile(f, '# 需求\n注册功能\n', 'utf8');
    expect(await readDoc(f)).toContain('注册功能');
  });

  it('拖拽式带引号路径也能读', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'testpilot-doc-'));
    const f = path.join(dir, 'spec.txt');
    await writeFile(f, '内容', 'utf8');
    expect(await readDoc(`'${f}'`)).toBe('内容');
  });

  it('.doc 明确报错引导转格式', async () => {
    await expect(readDoc('/x/old.doc')).rejects.toThrow(/另存为|docx|PDF/);
  });
});
