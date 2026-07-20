# TestPilot

本地优先的 AI 测试工具。在你自己的电脑上,让 AI 像真实用户一样测试你的 **Web 应用** 和
**Android 应用**(iOS 规划中):既能自主探索发现缺陷,也能执行你写的/由需求文档与 Figma
生成的测试用例,产出带截图和复现步骤的 HTML 报告。

> 2026-07 起从多租户 SaaS 平台重定位为纯 CLI 本地工具。历史平台代码见 git 历史。

## 能力

- **AI 自主探索**:给一个 URL 或 App 包名,AI 自动点击、输入、走流程,发现崩溃、报错、
  接口异常、ANR 等缺陷。
- **用例执行**:用 YAML/JSON 写测试用例(动作 + 断言),AI 逐条执行并判定通过/失败/阻塞。
- **文档 → 用例**(建设中):导入需求文档 / Figma(经 Figma MCP)自动生成测试用例。
- **双端**:Web(Playwright)+ Android(adb 模拟器/真机);统一的探索循环与报告。
- **安全护栏**:支付、删除、发送等不可逆操作自动拦截。

## 快速开始

```bash
pnpm install

# 配置多模态模型(AI 探索/用例执行需要;推荐 DashScope Qwen-VL)
export OPENAI_API_KEY=sk-xxx
export OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export MIDSCENE_MODEL_NAME=qwen-vl-max-latest
export MIDSCENE_USE_QWEN_VL=1

# AI 探索一个网站
pnpm tp explore https://example.com --steps 20 --goal "测试注册流程"

# 探索本机 Android 应用(需已启动模拟器/连接真机)
pnpm tp explore-app com.example.app --steps 20

# 执行用例文件(见 examples/login-cases.yaml)
pnpm tp run-cases examples/login-cases.yaml
```

启发式探索(纯爬行,零模型成本)可作为冒烟:`pnpm tp explore <url> --mode heuristic`。

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
  engine/     Explorer(自主探索)+ CaseRunner(用例执行)+ HTML 报告
apps/
  cli/        testpilot 命令行(explore / explore-app / run-cases)
examples/     用例文件示例
```
