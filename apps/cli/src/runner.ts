import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebExecutor } from '@testpilot/executor';
import type { ModelConfig, RunReport } from '@testpilot/shared';
import { AiBrain, CliBrain, Explorer, HeuristicBrain, type Brain } from '@testpilot/engine';

interface ClaimedRun {
  id: string;
  mode: string;
  goal: string | null;
  stepBudget: number;
  targetUrl: string;
  modelConfig: ModelConfig | null;
}

export interface RunnerOptions {
  serverUrl: string;
  token: string;
  /** 显示浏览器窗口(围观 AI 操作/调试用),默认无头不可见 */
  headed?: boolean;
  /** 空闲轮询间隔 ms */
  pollInterval?: number;
  log?: (message: string) => void;
}

/**
 * 自托管 Runner:轮询平台领取本账号的 runner 任务,在本机执行后回传。
 * 价值:用本机的 CLI 订阅(cli 模式)与内网可达性,平台云端无需模型 key。
 */
export class Runner {
  private stopped = false;
  private readonly poll: number;
  private readonly log: (m: string) => void;

  constructor(private readonly opts: RunnerOptions) {
    this.poll = opts.pollInterval ?? 3000;
    this.log = opts.log ?? ((m) => console.log(m));
  }

  stop(): void {
    this.stopped = true;
  }

  async loop(): Promise<void> {
    this.log(`🛰  Runner 已连接 ${this.opts.serverUrl},等待任务…(Ctrl+C 退出)`);
    while (!this.stopped) {
      try {
        const run = await this.claim();
        if (run) {
          await this.execute(run);
          continue; // 干完立刻再领,不空等
        }
      } catch (err) {
        this.log(`⚠ 与服务器通信失败:${err instanceof Error ? err.message : err}`);
      }
      await sleep(this.poll);
    }
  }

  private async request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(new URL(pathname, this.opts.serverUrl), {
      ...init,
      headers: {
        'x-runner-token': this.opts.token,
        ...(init.body && !(init.body instanceof Uint8Array) ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const payload = (await res.json().catch(() => null)) as { ok: boolean; data?: T; error?: string } | null;
    if (!res.ok || !payload?.ok) {
      throw new Error(payload?.error ?? `HTTP ${res.status}`);
    }
    return payload.data as T;
  }

  private async claim(): Promise<ClaimedRun | null> {
    const data = await this.request<{ run: ClaimedRun | null }>('/api/runner/claim', { method: 'POST' });
    return data.run;
  }

  /** 单个任务:本机执行 → 上传截图 → 回传报告;失败则上报 fail */
  private async execute(run: ClaimedRun): Promise<void> {
    this.log(`▶ 领取任务 ${run.id}:${run.targetUrl}(模式 ${run.mode},${run.stepBudget} 步)`);
    const outDir = await mkdtemp(path.join(os.tmpdir(), `testpilot-runner-${run.id}-`));
    const executor = new WebExecutor({ headless: !this.opts.headed });
    try {
      const explorer = new Explorer(executor, this.brainFor(run, executor), {
        targetUrl: run.targetUrl,
        goal: run.goal ?? undefined,
        stepBudget: run.stepBudget,
        outDir,
        mode: run.mode === 'ai' ? 'ai' : run.mode === 'cli' ? 'cli' : 'heuristic',
        onProgress: (m) => this.log(`  ${m}`),
      });
      const report = await explorer.run();
      await this.uploadArtifacts(run.id, path.join(outDir, 'screenshots'));
      await this.request(`/api/runner/runs/${run.id}/complete`, {
        method: 'POST',
        body: JSON.stringify({ report: report satisfies RunReport }),
      });
      this.log(`✅ 任务 ${run.id} 完成:${report.findings.length} 个缺陷,已回传`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`❌ 任务 ${run.id} 失败:${message}`);
      await this.request(`/api/runner/runs/${run.id}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error: message.slice(0, 500) }),
      }).catch(() => {});
    } finally {
      await executor.dispose();
    }
  }

  private brainFor(run: ClaimedRun, executor: WebExecutor): Brain {
    if (run.mode === 'ai') return new AiBrain(executor, run.modelConfig ?? undefined);
    if (run.mode === 'cli') return new CliBrain(executor);
    return new HeuristicBrain(executor, run.targetUrl, run.goal ?? undefined);
  }

  private async uploadArtifacts(runId: string, shotsDir: string): Promise<void> {
    const files = await readdir(shotsDir).catch(() => [] as string[]);
    for (const file of files) {
      if (!file.endsWith('.png')) continue;
      const body = await readFile(path.join(shotsDir, file));
      await this.request(`/api/runner/runs/${runId}/artifacts/${file}`, {
        method: 'POST',
        body: new Uint8Array(body),
        headers: { 'content-type': 'image/png' },
      }).catch((err) => this.log(`  ⚠ 截图 ${file} 上传失败:${err instanceof Error ? err.message : err}`));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
