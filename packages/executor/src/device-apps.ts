import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** 解析 adb 绝对路径(优先 ANDROID_HOME/platform-tools,免依赖 PATH) */
export function adbBin(): string {
  const home =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(homedir(), 'Library/Android/sdk');
  const p = path.join(home, 'platform-tools', 'adb');
  return existsSync(p) ? p : 'adb';
}

function run(cmd: string, args: string[], timeout = 10_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout);
    });
  });
}

export interface DeviceApp {
  /** Android=包名,iOS=bundle id */
  id: string;
  /** 展示名(iOS 有;Android 通常没有,回退用 id) */
  name?: string;
}

/** 列出 Android 设备上的第三方(用户安装)应用包名 */
export async function listAndroidApps(deviceId?: string): Promise<DeviceApp[]> {
  const base = deviceId ? ['-s', deviceId] : [];
  const out = await run(adbBin(), [...base, 'shell', 'pm', 'list', 'packages', '-3']);
  return out
    .split('\n')
    .map((l) => l.trim().replace(/^package:/, ''))
    .filter((p) => /^[a-zA-Z][\w.]+$/.test(p))
    .sort()
    .map((id) => ({ id }));
}

/** 读 Android 当前前台应用包名(没有返回 null) */
export async function foregroundAndroidApp(deviceId?: string): Promise<string | null> {
  const base = deviceId ? ['-s', deviceId] : [];
  const out = await run(adbBin(), [...base, 'shell', 'dumpsys', 'activity', 'activities']);
  const m = out.match(/(?:topResumedActivity|mResumedActivity|ResumedActivity)[^\n]*\s([a-zA-Z][\w.]+)\//);
  return m?.[1] ?? null;
}

/** adb 已连接设备序列号 */
export async function listAndroidDevices(): Promise<string[]> {
  const out = await run(adbBin(), ['devices']);
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.split('\t'))
    .filter(([, state]) => state?.trim() === 'device')
    .map(([serial]) => serial!.trim())
    .filter(Boolean);
}

/** 列出 iOS 已启动模拟器上的用户应用(bundle id + 名称) */
export async function listBootedIosApps(): Promise<DeviceApp[]> {
  const out = await run('xcrun', ['simctl', 'listapps', 'booted']);
  const apps: DeviceApp[] = [];
  // 逐个应用块:"<id>" = { ... };
  const blockRe = /"([\w.\-]+)"\s*=\s*\{([\s\S]*?)\n {4}\};/g;
  for (let m = blockRe.exec(out); m; m = blockRe.exec(out)) {
    const body = m[2] ?? '';
    const type = body.match(/ApplicationType\s*=\s*(\w+)/)?.[1];
    if (type !== 'User') continue; // 只要用户装的 App,过滤系统 App
    const bundleId = body.match(/CFBundleIdentifier\s*=\s*"?([\w.\-]+)"?/)?.[1] ?? m[1]!;
    const name =
      body.match(/CFBundleDisplayName\s*=\s*"?([^";\n]+?)"?\s*;/)?.[1]?.trim() ??
      body.match(/CFBundleName\s*=\s*"?([^";\n]+?)"?\s*;/)?.[1]?.trim();
    apps.push({ id: bundleId, name });
  }
  return apps.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));
}
