import { describe, expect, it } from 'vitest';
import { parseFigmaUrl } from './figma.js';

describe('parseFigmaUrl', () => {
  it('解析 design 链接 + node-id', () => {
    const r = parseFigmaUrl('https://www.figma.com/design/abc123XYZ/My-App?node-id=12-34&t=x');
    expect(r.fileKey).toBe('abc123XYZ');
    expect(r.nodeId).toBe('12:34');
  });

  it('解析 file 链接(无 node)', () => {
    const r = parseFigmaUrl('https://www.figma.com/file/KEY999/Design');
    expect(r.fileKey).toBe('KEY999');
    expect(r.nodeId).toBeUndefined();
  });

  it('裸 fileKey 也接受', () => {
    expect(parseFigmaUrl('aBc123').fileKey).toBe('aBc123');
  });

  it('node-id 用 %3A 编码也能还原', () => {
    expect(parseFigmaUrl('https://figma.com/design/K/N?node-id=5%3A6').nodeId).toBe('5:6');
  });

  it('非法输入抛错', () => {
    expect(() => parseFigmaUrl('https://example.com/foo')).toThrow(/无法解析/);
  });
});
