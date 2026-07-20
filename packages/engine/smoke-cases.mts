import { WebExecutor } from '@testpilot/executor';
import { startBuggySite } from './fixtures/buggy-site.js';
import { CaseRunner } from './src/case-runner.js';
import { CliWebAgent } from './src/brains/cli-agent.js';

const site = await startBuggySite();
const suite = {
  target: site.url, platform: 'web' as const,
  cases: [
    { id: 'c1', name: '首页加载', steps: [
      { action: '停留在当前首页', expect: '页面显示了「加入购物车」按钮' },
    ]},
    { id: 'c2', name: '导航到关于页', steps: [
      { action: '点击「关于我们」链接', expect: '页面标题包含「关于」' },
    ]},
  ],
};
const executor = new WebExecutor();
const runner = new CaseRunner(executor, suite, {
  outDir: '/tmp/cli-cases-run',
  agentFactory: async (t) => new CliWebAgent(t as WebExecutor),
  onProgress: (m) => console.log('  ', m),
});
try {
  const r = await runner.run();
  console.log('RESULT passed=', r.passed, 'failed=', r.failed, 'blocked=', r.blocked);
  for (const c of r.results) console.log('  -', c.name, '=>', c.status, c.steps.map(s=>s.status).join(','));
} finally {
  await executor.dispose();
  await site.close();
}
