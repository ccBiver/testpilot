# TestPilot 任务清单

> 版本 v0.1 · 2026-07-14 · 里程碑制,每个里程碑结束有可验证的验收标准

## M0 — 核心执行器验证 ⬅ 当前(2026-07-14 主体完成)

目标:不做平台,先用 CLI 证明「AI 探索 → 发现缺陷 → 出报告」这条链路成立。

- [x] pnpm monorepo 脚手架(apps/、packages/、TS 严格模式)
- [x] packages/executor:Playwright Web 适配,observe/信号采集/截图/点击;AI 模式经 Midscene 复用同一 page
- [x] packages/detectors:console-error、network-failure、crash 三个客观检测器(含噪音过滤)
- [x] Explorer v0:步数预算 + 页面地图去重 + 指纹去重,轨迹落 report.json + 截图
- [x] CLI:`pnpm explore <url> --steps 30 --goal "..." --mode heuristic|ai` → report.json + HTML 报告
- [x] 安全护栏 v0:敏感操作词表拦截(资金/破坏性/对外发送/登出)
- [x] 双模式大脑:heuristic(零成本爬行,已验证)/ ai(Midscene,待配模型 key 后实测)
- [x] 单测 + 端到端(24 个测试):演示站上找到 JS 报错/接口 500/死链,护栏拦截「删除账号」
- [ ] 验收补全:配模型 key 实测 AI 模式;对 appshield 前端等真实项目跑一轮
- [ ] 补 lint(biome)与 CI

### M0 已交付的前端(原 M1 范围提前)
- [x] apps/web:宣传首页(活泼简约 + framer-motion 动效 + SVG 线性图标)
- [x] 登录/注册页(表单校验,提交为模拟,待 M1 接后端)
- [x] 控制台/后台占位页;`/demo-report/report.html` 可看真实生成的报告样例

## M1 — 平台化(约 2.5~3 周)

目标:对外可用的 Web 平台——宣传页、注册登录、用户控制台、管理后台。

- [ ] docker-compose:postgres + redis + minio(暂缓:认证切片用 SQLite,见架构决策)
- [x] apps/server:Fastify + zod + Prisma,User 模型落库(2026-07-14)
- [x] 认证:注册/登录/refresh/me,JWT 双令牌,登录限流,首用户自动 admin,
      禁用账号拦截,统一错误信封;9 个 e2e 测试全绿(忘记密码后置)
- [x] 数据隔离:Project/Run 查询强制按 userId 过滤,跨用户访问统一 404(2026-07-14)
- [x] Project/Run 模型 + 发起探索 API + 进程内串行运行队列(接口对齐 BullMQ,
      Redis 常驻后平替);截图存本地 data/artifacts,带鉴权 + 防目录穿越下发(2026-07-14)
- [x] Finding → Issue 去重聚合(指纹匹配),状态流转 API
- [x] apps/web 公开区:宣传首页(动效 Hero/功能卡/CTA,SVG 图标)+ 登录注册页已接真后端,
      控制台外壳带登录守卫与退出(2026-07-14)
- [x] apps/web 控制台:项目列表/新建、项目详情发起探索(目标/步数/模式)、
      运行详情(状态轮询、统计卡、缺陷卡带复现步骤+证据+鉴权截图、探索轨迹)(2026-07-14)
- [x] Bug 看板:跨运行 Issue 聚合视图(级别/状态筛选、误报标记)
- [ ] apps/web 管理后台:用户管理、全局运行监控、模型 key 配置、注册开关
- [x] BYOK 用户级模型配置:加密存储、设置页、AI 运行按用户供能(2026-07-15)
- [x] CliBrain:本机 claude -p 作决策大脑(零 API 成本),执行器支持表单填写,
      三层模式 heuristic/ai/cli 全链路打通(2026-07-15)
- [x] 自托管 Runner 通道:Runner Token(sha256)、claim 原子抢占协议、结果/截图回传、
      testpilot runner 命令、设置页 Token 管理、发起表单执行位置选择;
      可用本机 CLI 订阅并测内网站点,实测演示站全链路通(2026-07-15)
- [ ] 运行中 WebSocket 进度推送
- [ ] 验收:新用户从宣传页注册 → 建项目 → 发起探索 → 看板出现 Bug → 标记误报/确认;
      admin 在后台能看到该用户与运行记录并可禁用

## M2 — Android 接入(约 1~1.5 周)

- [ ] executor 增加 Android 适配(Midscene android + adb),模拟器优先
- [ ] logcat 崩溃/ANR 检测器
- [ ] 平台 Target 支持 apk 上传/包名 + 设备选择
- [ ] 验收:对楠哥快跑或任一 demo App 完成一次探索并出报告

## M3 — 用例导入与回归(约 1.5 周)

- [ ] 用例统一 schema(steps + assertions)+ 用例库 CRUD
- [ ] 导入器:YAML(Midscene 原生)、Excel、自然语言粘贴
- [ ] CaseRunner:逐条执行判定,失败证据采集
- [ ] 回归集一键执行 + 回归报告(通过率、对比上次)
- [ ] 定时任务(cron)与 Webhook 触发
- [ ] 验收:导入 20 条用例跑回归,判定准确率 ≥90%

## M4 — 增强(排期待定)

- [ ] iOS 支持(Midscene iOS)
- [ ] 团队/组织:项目共享、成员角色细分(多用户基础已在 M1)
- [ ] GitHub Issue / Jira / 飞书推送
- [ ] 质量趋势图、成本看板(每次运行模型花费)
- [ ] 录制回放生成用例

## 贯穿事项

- 每个里程碑:核心逻辑单测(detectors、指纹去重、用例解析必须 80%+),
  E2E 用平台自己测自己(dogfooding)
- 模型 key 走环境变量,启动时校验;所有运行带 token 预算上限
