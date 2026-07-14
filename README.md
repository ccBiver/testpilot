# TestPilot 🛰

AI 自主测试平台:像真实用户一样探索 Web/App,自动发现缺陷,生成带截图与复现步骤的 Bug 报告。

## 快速开始

```bash
pnpm install
pnpm --filter @testpilot/executor exec playwright install chromium

# 零成本启发式探索(无需模型 key)
pnpm explore https://your-site.com --steps 30

# AI 自主探索(先配置 .env,参考 .env.example)
pnpm explore https://your-site.com --steps 30 --mode ai --goal "重点测试下单流程"

# 宣传站/前端
pnpm web:dev   # http://localhost:5180
```

探索完成后在 `runs/<时间戳>/report.html` 查看报告。发现缺陷时 CLI 退出码为 2,可直接接入 CI。

## 仓库结构

```
apps/cli        探索 CLI(M0)      apps/web   宣传页 + 登录注册(M1 平台前端底座)
packages/executor   Playwright/Midscene 执行器与安全护栏
packages/detectors  缺陷检测器(console/网络/崩溃)
packages/shared     类型与缺陷指纹
docs/               PRD、架构、任务清单
```

## 测试

```bash
pnpm -r test        # 单测 + 端到端(内置带 Bug 演示站)
pnpm -r typecheck
```
