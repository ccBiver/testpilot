# TestPilot 架构设计

> 版本 v0.1 · 2026-07-14

## 1. 技术选型结论

**全 TypeScript 单仓(pnpm monorepo)**。核心理由:执行引擎选定
[Midscene.js](https://github.com/web-infra-dev/midscene)(Node/TS),
若后端用 Python 则 worker 与平台跨语言,运维和类型共享成本高;
全 TS 后 worker 可直接 import Midscene SDK,共享类型定义。

| 层 | 选型 | 说明 |
|----|------|------|
| UI 执行引擎 | **Midscene.js**(MIT) | 视觉驱动,一套 API 覆盖 Web/Android/iOS;aiAct/aiQuery/aiAssert;支持 YAML 用例;不依赖选择器,UI 变化不易失效 |
| Web 驱动 | Playwright(Midscene 集成) | headless/headed 均可,自带 console/network 采集 |
| Android 驱动 | Midscene Android(adb) | 模拟器或真机;logcat 采集崩溃 |
| 多模态模型 | 可配置:Qwen-VL / UI-TARS / GLM-4V / Claude | 探索决策与视觉断言;支持自托管开源模型控成本 |
| 后端 API | Fastify + zod | 原计划 NestJS,实施时改为 Fastify:全链路 tsx/vitest(esbuild)不支持 Nest 依赖的 emitDecoratorMetadata,引入 SWC 工具链得不偿失;模块化路由 + preHandler 守卫能力等价(见决策 5) |
| 任务队列 | BullMQ + Redis | 运行任务异步化,worker 水平扩展 |
| 数据库 | PostgreSQL + Prisma(认证切片暂用 SQLite) | 项目/运行/缺陷/用例;JSONB 存执行轨迹;本机 Docker 未常驻,User 表先跑 SQLite,做 Run/Finding 存储(需 Json 字段)时切 provider 并启用 compose |
| 对象存储 | 本地磁盘(MVP)→ MinIO/S3 | 截图、录屏、报告产物 |
| 前端 | React + Vite + TS | 宣传页 + 控制台 + 管理后台;组件库 shadcn/ui |
| 认证 | NestJS Passport + JWT | 邮箱密码注册/登录,refresh token,bcrypt 存储;角色守卫 user/admin |

## 2. 系统结构

```
┌────────────┐   REST/WS    ┌────────────┐   BullMQ    ┌─────────────────┐
│  React Web │ ◄──────────► │ NestJS API │ ◄─────────► │ Worker(可多实例)│
│  看板/报告  │              │ 项目/任务/  │    Redis    │ ┌─────────────┐ │
└────────────┘              │ 缺陷/用例   │             │ │ Explorer    │ │
                            └─────┬──────┘             │ │ 探索代理循环 │ │
                                  │                    │ ├─────────────┤ │
                            ┌─────▼──────┐             │ │ CaseRunner  │ │
                            │ PostgreSQL │             │ │ 用例执行器   │ │
                            │ + 对象存储  │◄────────────│ ├─────────────┤ │
                            └────────────┘  截图/产物   │ │ Detectors   │ │
                                                       │ │ 缺陷检测器   │ │
                                                       │ └──────┬──────┘ │
                                                       │   Midscene SDK  │
                                                       └───┬─────────┬───┘
                                                     Playwright     adb
                                                        Web       Android
```

## 3. 核心模块设计

### 3.1 Executor 抽象(packages/executor)

统一 Web/Android 的执行接口,worker 不感知平台差异:

- `observe()` → 截图 + 界面元素树 + 当前 URL/Activity
- `act(instruction)` → 自然语言操作(内部走 Midscene aiAct)
- `assert(condition)` → 视觉断言(aiAssert)
- `collectSignals()` → console/network/logcat 增量信号
- 生命周期:`launch / reset / dispose`

### 3.2 Explorer 探索代理(worker 内)

Agent 循环,每步:
1. `observe()` 获取当前状态,更新「页面地图」(已访问状态图,避免绕圈);
2. LLM 决策下一步:未探索的交互点 > 用户目标相关流程 > 返回;
3. `act()` 执行,`collectSignals()` 喂给检测器;
4. 检测器命中 → 生成 Finding(截图 + 至今的操作路径即复现步骤);
5. 预算(步数/token/时长)耗尽或覆盖收敛 → 结束,产出运行报告。

关键设计:
- **操作轨迹即复现步骤**:每步记录自然语言描述 + 截图,Finding 直接引用前 N 步。
- **安全护栏**:敏感操作(支付/删除/发送)词表拦截 + 项目级只读模式。
- **去重**:Finding 指纹 = 检测器类型 + 规范化错误信息 + 页面标识,跨运行合并。

### 3.3 Detectors 缺陷检测器(可插拔)

每个检测器实现 `onSignal(signal, ctx) → Finding | null`:
`crash`、`console-error`、`network-failure`、`dead-interaction`(点击后状态无变化)、
`visual-anomaly`(AI 判定,带置信度)。检测维度与级别见 PRD §5。

### 3.4 CaseRunner 用例执行器

- 用例格式:平台统一为「步骤列表(自然语言)+ 断言列表」,
  兼容导入 YAML(Midscene 原生格式)/ Excel(列:模块/步骤/预期)。
- 逐条 `act` + `assert`,失败即采集证据,产出 通过/失败/阻塞。

### 3.5 数据模型(核心表)

```
User(email, passwordHash, role: user|admin, status)
User ──< Project
Project ──< Target(web url / android package)
Project ──< TestCase(steps json, tags, 是否回归集)
Project ──< Run(mode: explore|regression, status, budget, cost, 环境)
Run ──< Step(seq, instruction, screenshot, signals json)
Run ──< Finding(detector, severity, fingerprint, evidence json, status)
Finding >── Issue(看板实体:跨 Run 去重合并后的 Bug,状态流转)
```

### 3.6 认证与权限

- 注册/登录:邮箱 + 密码(bcrypt),JWT access + refresh;注册开关存系统配置表。
- 数据隔离:所有业务查询强制按 `userId` 过滤(Prisma 中间件统一注入),
  admin 角色可跨用户查询;角色用 NestJS Guard + 装饰器声明。
- 管理后台复用同一 API 服务,`/admin/*` 路由整体挂 admin 守卫。
- 限流:登录/注册接口按 IP 限流,防撞库。

## 4. 仓库结构

```
testpilot/
├── apps/
│   ├── server/          # NestJS API + BullMQ 生产者
│   ├── worker/          # 消费任务,运行 Explorer/CaseRunner
│   └── web/             # React:/ 宣传页,/auth 登录注册,/console 控制台,/admin 后台
├── packages/
│   ├── executor/        # Midscene 封装 + Web/Android 适配
│   ├── detectors/       # 缺陷检测器
│   └── shared/          # 类型、Finding schema、用例格式
├── docs/
└── docker-compose.yml   # postgres + redis + minio
```

## 5. 关键决策记录

1. **买 Midscene 不自研驱动**:双端统一、视觉驱动免维护选择器、MIT 可商用;
   代价是绑定其 API,缓解:executor 包做隔离层。
2. **全 TS 而非 FastAPI+React**:消除跨语言队列协议,worker 直用 SDK。
3. **Finding 与 Issue 分离**:每次运行的原始发现(Finding)不可变,
   看板上的 Bug(Issue)是去重聚合后的实体,支持人工确认/误报标记。
4. **模型可配置**:探索决策用强模型,视觉断言可降级到自托管 Qwen-VL/UI-TARS 控成本。
5. **Fastify 替代 NestJS**(2026-07-14):esbuild 系工具链(tsx/vitest)不支持
   emitDecoratorMetadata,Nest 的构造器注入与 class-validator 需要额外 SWC 配置;
   Fastify + zod + preHandler 守卫以更小的机器达到同等模块化,且与 monorepo 其余部分
   工具链一致。API 统一信封 { ok, data, error } 不变。
6. **双模式探索大脑**(M0 落地):heuristic(纯 Playwright,零模型成本冒烟爬行)
   与 ai(Midscene)共用 Explorer/检测器/报告管线,免费模式也是 CI 冒烟的卖点。
