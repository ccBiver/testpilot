# TestPilot

[![npm](https://img.shields.io/npm/v/@biver/testpilot?color=5eead4&label=%40biver%2Ftestpilot)](https://www.npmjs.com/package/@biver/testpilot)
[![node](https://img.shields.io/node/v/@biver/testpilot?color=5eead4)](https://www.npmjs.com/package/@biver/testpilot)
[![license](https://img.shields.io/badge/license-MIT-5eead4)](./LICENSE)

本地优先的 AI 测试工具。在你自己的电脑上,让 AI 像真实用户一样测试你的 **Web / Android / iOS 应用**:
既能自主探索发现缺陷,也能执行你写的、或由需求文档与 Figma 生成的测试用例,
产出带截图和复现步骤的 HTML / Markdown 报告。Web 与 Android 用本机 Claude 订阅驱动,零 API 成本。

> **📄 宣传与教程页**:<https://ccbiver.github.io/testpilot/>(座舱雷达风格,含交互向导演示与三端平台状态);
> 本地也可 `open docs/index.html`。

> 2026-07 起从多租户 SaaS 平台重定位为纯 CLI 本地工具。历史平台代码见 git 历史。

## 能力

- **AI 自主探索**:给一个 URL 或 App 包名,AI 自动点击、输入、走流程,发现崩溃、报错、
  接口异常、ANR 等缺陷,每个缺陷带截图与复现步骤。
- **文档 / Figma → 用例**:导入需求文档,或经 Figma MCP 拉设计稿,自动生成结构化测试用例。
- **用例执行**:YAML/JSON 用例逐条执行,AI 判定通过 / 失败 / 阻塞,出通过率报告。
- **三端**:Web(Playwright)+ Android(adb)+ iOS(WebDriverAgent,仅 macOS);统一探索循环与报告。
- **零 API 成本**:Web / Android 用本机 Claude 订阅驱动;赶时间可切多模态模型。
- **交互向导 + 安全护栏**:敲 `testpilot` 一步步选;支付、删除、发送等不可逆操作自动拦截。

## 安装

已发布到 npm(命令仍是 `testpilot`):

```bash
npm i -g @biver/testpilot     # 或免安装直跑:npx @biver/testpilot
testpilot                     # 任意目录
```

从源码本地开发:

```bash
pnpm install
pnpm install:cli    # 构建并把 testpilot 装为全局命令(软链到 ~/.local/bin)
```

之后在任意目录直接用 `testpilot`。改了源码后重跑 `pnpm install:cli` 即可更新。
(开发时也可免构建直跑:`pnpm tp <command>`)

## 快速开始

最简单:直接敲 **`testpilot`**,进入交互式向导,一步步选择即可(探索 / 生成用例 / 执行用例),
无需记命令和参数。

```bash
testpilot          # ← 交互向导,新手推荐
```

熟练后也可用子命令(适合脚本化)。默认用本机 **Claude Code CLI** 驱动,零 API 成本。

```bash
# 需求文档 → 生成用例(纯文本,claude CLI)
testpilot gen-cases requirements.md --target https://example.com --out cases.yaml

# Figma 设计稿 → 生成用例(默认走 Figma 桌面 App 的 Dev Mode MCP,无需 token;
# 先在 Figma 桌面开启 Dev Mode → Enable MCP server,并选中要测的画板)
testpilot gen-cases --figma "https://figma.com/design/KEY/App?node-id=1-2" --target https://example.com
# 无桌面 App 时改用个人令牌:export FIGMA_API_KEY=figd_xxx; 加 --figma-token

# 执行用例(默认 --engine cli,用本机 claude;--engine midscene 用模型 key)
testpilot run-cases cases.yaml

# AI 自主探索网站
testpilot explore https://example.com --steps 20 --goal "测试注册流程" --mode cli

# 探索本机 Android 应用(需已启动模拟器/连接真机)
testpilot explore-app com.example.app --steps 20
```

启发式探索(纯爬行,连模型都不用)可作为冒烟:`testpilot explore <url> --mode heuristic`。

### 可选:用多模态模型替代本机 CLI

批量回归赶时间时,配 DashScope Qwen-VL 更快(claude CLI 每步要起进程,较慢):

```bash
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export MIDSCENE_MODEL_NAME=qwen-vl-max-latest
export MIDSCENE_USE_QWEN_VL=1
testpilot run-cases cases.yaml --engine midscene
```

## 用例文件格式

```yaml
target: https://example.com/   # web=URL,android=包名
platform: web                  # web | android
cases:
  - name: 注册流程
    steps:
      - action: 点击「注册」入口
        expect: 出现注册表单       # expect 可选,省略则只执行不校验
      - action: 在邮箱框填入 test@example.com
      - action: 点击提交
        expect: 提示注册成功
```

## 结构

```
packages/
  shared/     类型、缺陷指纹、用例/报告模型
  executor/   WebExecutor(Playwright)+ AndroidExecutor(adb)+ 统一 ExplorerTarget/AiAgent
  detectors/  缺陷检测器(console/network/crash · logcat)
  engine/     Explorer(自主探索)+ CaseRunner(用例执行)+ 文档/Figma 生成用例 + HTML/MD 报告
apps/
  cli/        testpilot 命令行(交互向导 + explore / explore-app / explore-ios / gen-cases / run-cases)
examples/     用例文件示例
docs/         宣传页(index.html)+ PRD / 架构 / 任务清单
```

## 发布宣传页(GitHub Pages)

宣传页在 `docs/index.html`,已配好自动部署工作流 `.github/workflows/pages.yml`。推到 GitHub 后:

1. 推送到 GitHub(仓库需为 public,或 Pages 已在你的账号计划内):
   ```bash
   git remote add origin git@github.com:<用户名>/<仓库名>.git
   git push -u origin main
   ```
2. 仓库 **Settings → Pages → Source** 选 **GitHub Actions**(工作流会自动启用 Pages 并部署)。
3. 部署完成后访问 `https://<用户名>.github.io/<仓库名>/`。

之后每次改动 `docs/` 推上去都会自动重新发布。
