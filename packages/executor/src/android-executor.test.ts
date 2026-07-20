import { describe, expect, it } from 'vitest';
import { parseUiautomator } from './android-executor.js';

const XML = `<?xml version='1.0'?>
<hierarchy>
  <node text="登录" class="android.widget.Button" clickable="true" bounds="[0,100][200,180]" />
  <node text="" content-desc="搜索" class="android.widget.ImageView" clickable="true" bounds="[300,100][360,160]" />
  <node text="" class="android.widget.EditText" clickable="false" bounds="[0,200][400,260]" />
  <node text="仅文本无点击" class="android.widget.TextView" clickable="false" bounds="[0,300][400,340]" />
  <node text="登录" class="android.widget.Button" clickable="true" bounds="[0,100][200,180]" />
</hierarchy>`;

describe('parseUiautomator', () => {
  it('提取可点击/输入元素,算中心坐标', () => {
    const els = parseUiautomator(XML);
    const login = els.find((e) => e.label === '登录');
    expect(login).toBeTruthy();
    expect(login!.center).toEqual([100, 140]);
    expect(login!.clickable).toBe(true);
  });

  it('content-desc 作为标签兜底', () => {
    expect(parseUiautomator(XML).some((e) => e.label === '搜索')).toBe(true);
  });

  it('EditText 即使不可点击也保留(输入框)', () => {
    const input = parseUiautomator(XML).find((e) => /EditText/.test(e.className));
    expect(input).toBeTruthy();
    expect(input!.label).toContain('EditText');
  });

  it('无文本且不可点击的纯 TextView 被过滤', () => {
    expect(parseUiautomator(XML).some((e) => e.label === '仅文本无点击')).toBe(false);
  });

  it('相同元素去重', () => {
    expect(parseUiautomator(XML).filter((e) => e.label === '登录')).toHaveLength(1);
  });

  it('空/坏输入 → 空数组', () => {
    expect(parseUiautomator('')).toEqual([]);
    expect(parseUiautomator('<hierarchy></hierarchy>')).toEqual([]);
  });
});
