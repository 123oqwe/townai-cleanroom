# TownAI Cleanroom 重构提示词

按优先级排列，每个提示词可直接粘贴给 AI 编程 agent 执行。每个任务完成后运行
`pnpm verify` 确认没有破坏任何东西，再进入下一个。

---

## 提示词 1：拆分 apps/api/src/ 目录结构（最高优先级）

```
重构 apps/api/src/ 目录。当前 40 个 .ts 文件全部平铺在 src/ 下，需要按功能
分组到子目录中。

目标结构：

  apps/api/src/
  ├── routes/          # 所有 *-routes.ts（HTTP 路由注册）
  │   ├── admin-routes.ts
  │   ├── agent-routes.ts
  │   ├── a2a-routes.ts
  │   ├── account-routes.ts
  │   ├── billing-routes.ts
  │   ├── channel-routes.ts
  │   ├── content-routes.ts
  │   ├── knowledge-routes.ts
  │   ├── mcp-routes.ts
  │   ├── operations-routes.ts
  │   ├── pipedream-routes.ts
  │   ├── routine-routes.ts
  │   ├── runtime-routes.ts
  │   ├── schedule-routes.ts
  │   ├── shared-account-routes.ts
  │   ├── square-routes.ts
  │   ├── suggestion-routes.ts
  │   └── tool-routes.ts
  ├── webhooks/        # 所有 *-events.ts（第三方 webhook 接收器）
  │   ├── slack-events.ts
  │   ├── telegram-events.ts
  │   ├── whatsapp-events.ts
  │   ├── twilio-voice-events.ts
  │   └── vapi-voice-events.ts
  ├── oauth/           # OAuth 回调路由
  │   ├── google-oauth-routes.ts
  │   └── microsoft-oauth-routes.ts
  ├── pollers/         # 后台轮询器
  │   ├── google-calendar-poller.ts
  │   └── google-routine-poller.ts
  ├── tools/           # Harness 工具绑定
  │   ├── harness-tools.ts
  │   ├── workspace-tools.ts
  │   └── code-runner.ts
  ├── lib/             # 基础设施和辅助模块
  │   ├── auth.ts
  │   ├── content-storage.ts
  │   ├── elevenlabs-voice.ts
  │   ├── public-share-html.ts
  │   ├── routine-finalizer.ts
  │   ├── routine-scheduler.ts
  │   ├── voice-routes.ts
  │   └── harness-runtime-adapter.ts
  ├── app.ts           # 留在根（Hono 应用组装）
  └── index.ts         # 留在根（依赖注入 + 启动）

规则：
1. 只移动文件，不修改任何文件内容。
2. 移动后更新所有相对导入路径。文件间用的是 "./xxx.js" 形式的相对导入，
   移到子目录后需要改为 "../xxx.js" 或 "../lib/xxx.js" 等。
3. 对 @town/* 包的导入不需要改（它们是 workspace 引用）。
4. 不要移动 app.ts 和 index.ts，它们留在 src/ 根目录。
5. 对应的 test/ 目录不动——测试文件保持原名留在 apps/api/test/。
6. 完成后运行 pnpm typecheck 确认所有导入路径正确。
7. 运行 pnpm test 确认所有测试通过。
```

---

## 提示词 2：拆分 apps/api/src/tools/harness-tools.ts（1217 行）

```
拆分 apps/api/src/tools/harness-tools.ts。这个文件有 1217 行，包含 15+ 个
harness 工具绑定函数。需要按工具类别拆分成多个文件。

当前文件的导出函数（按主题分组）：

搜索与网页工具 → src/tools/web-tools.ts
  - createTownWebFetchHarnessBinding
  - createTownSearchHarnessBinding
  - createTownContextHarnessBinding

记忆与语音工具 → src/tools/knowledge-tools.ts
  - createTownVoiceSpeakHarnessBinding
  - createTownMemoryAddHarnessBinding

Google 集成工具 → src/tools/google-tools.ts
  - createGoogleGmailSearchHarnessBinding
  - createGoogleGmailGetMessageHarnessBinding
  - createGoogleGmailSendHarnessBinding
  - createGoogleCalendarFreeBusyHarnessBinding
  - createGoogleCalendarCreateEventHarnessBinding

例程与注册 → src/tools/registry-tools.ts
  - createInvokeRoutineHarnessBinding
  - createRegistryHarnessBindings
  - mcpToolName（内部函数）
  - mcpReadOnlyHint（内部函数）
  - mcpToolDefinitionVersion（如果在这个文件里）

规则：
1. 每个 Zod schema 跟着使用它的函数走。
2. 共享的常量（如 MAX_OUTPUT_CHARS, MAX_ITEM_TEXT_CHARS）放在使用它们的文件里，
   如果两个文件都用就提到一个 src/tools/shared.ts 里。
3. 创建 src/tools/index.ts 做桶文件，re-export 所有函数，保持外部导入路径不变。
4. 所有 import 这些函数的文件（主要是 index.ts 和 harness-runtime-adapter.ts）
   不需要改，因为桶文件保持 "./tools/harness-tools.js" → "./tools/index.js"
   的路径——不对，需要改导入路径。改为从 "./tools/index.js" 或具体子文件导入。
5. 完成后运行 pnpm typecheck && pnpm test 确认。
```

---

## 提示词 3：拆分 apps/api/src/index.ts（1204 行）和 app.ts（1116 行）

```
拆分 apps/api/src/index.ts 和 apps/api/src/app.ts。这两个文件分别 1204 行
和 1116 行，承担了依赖注入组装和 Hono 应用组装的过多职责。

index.ts 拆分方案：

当前 index.ts 做了两件事：
  (a) 从环境变量创建所有 repository/service 实例（约 600 行）
  (b) 注册 cron/poller/worker 启动逻辑（约 400 行）

拆为：
  src/config.ts
    - environmentSchema + environment 解析
    - 所有从 process.env 读取配置的逻辑

  src/dependencies.ts
    - export function createDependencies(env, database)
    - 创建所有 repository、service、cipher 实例并返回 AppDependencies 对象
    - 把 index.ts 中 createDatabase、createCredentialCipher、
      createXxxRepository 等调用搬到这里

  index.ts（精简后）
    - import { createDependencies } from "./dependencies.js"
    - import { createApp } from "./app.js"
    - 启动逻辑（serve、cron 注册、poller 启动）保留
    - 应该控制在 200-300 行

app.ts 拆分方案：

当前 app.ts 做了两件事：
  (a) 定义 createApp() 并注册所有路由（约 800 行）
  (b) 定义依赖组装函数 runtimeDependencies()、toolDependencies()、
      agentDependencies()、knowledgeDependencies()（约 300 行）

把 (b) 中的依赖组装函数移到 src/dependencies.ts（和 index.ts 的拆分合并）。
createApp() 本身可以通过把路由注册逻辑分到各 routes/ 文件的 registerXxxRoutes
函数中来精简。如果 app.ts 仍然超过 500 行，把错误处理中间件抽到
src/lib/error-middleware.ts。

规则：
1. 不要改变任何运行时行为。
2. 每次拆完后运行 pnpm typecheck && pnpm test。
3. 保持 api/index.js（Vercel 入口）的 import app from "../apps/api/dist/index.js"
   能正常工作——它导入的是构建产物，只要 index.ts 的默认导出不变就行。
```

---

## 提示词 4：拆分 admin-routes.ts（1013 行）

```
拆分 apps/api/src/routes/admin-routes.ts（1013 行）。

当前文件包含：
  - AdminDependencies 接口
  - 6+ 个 admin 报告查询函数（overview, users, agents, billing, routines...）
  - resolvePeriod、parseReportSlug 等辅助函数
  - registerAdminRoutes 注册函数

拆为：
  src/routes/admin/
  ├── types.ts              # AdminDependencies 接口 + 类型
  ├── reports.ts            # 各报告查询逻辑（collectOverviewReport 等）
  ├── helpers.ts            # resolvePeriod, parseReportSlug, reportNotFound 等
  └── index.ts              # registerAdminRoutes + 桶导出

规则：
1. 不改变路由路径和行为。
2. 完成后运行 pnpm typecheck && pnpm test。
```

---

## 提示词 5：修复 @town/db → @town/harness 分层倒置

```
修复 packages/db 对 packages/harness 的分层倒置依赖。

问题：packages/db/src/harness-thread-store.ts 导入了 @town/harness 的
threadSnapshotSchema、PersistentThreadStore、ThreadSnapshot 类型。
这导致低层的 db 包依赖了高层的 harness 包。

harness-thread-store.ts 的实际消费者：
  - packages/harness/src/app-server.ts（定义了 PersistentThreadStore 接口）
  - packages/harness/test/persistent-store.test.ts
  - apps/api/src/harness-runtime-adapter.ts（通过 @town/db 间接使用）

解决方案：把 harness-thread-store.ts 从 packages/db 移到 packages/harness：

1. 移动 packages/db/src/harness-thread-store.ts →
   packages/harness/src/persistent-thread-store.ts

2. 更新 packages/harness/src/index.ts，添加
   export * from "./persistent-thread-store.js";

3. 从 packages/db/src/index.ts 中删除
   export * from "./harness-thread-store.js";

4. 从 packages/db/package.json 的 dependencies 中删除
   "@town/harness": "file:../harness"

5. 更新 persistent-thread-store.ts 的导入：
   - 把 from "./client.js" 改为 from "@town/db"
   - 把 from "./schema.js" 改为 from "@town/db"
   （因为文件现在在 harness 包里，需要从 @town/db 导入数据库相关的东西）
   harness 包的 package.json 需要添加 "@town/db": "file:../db" 依赖。

6. 这会形成 db ← harness 单向依赖（harness 依赖 db，db 不再依赖 harness），
   这是正确的分层方向。

7. 更新 apps/api/src 中所有从 @town/db 导入 PersistentThreadStore 等类型
   的地方，改为从 @town/harness 导入。

8. packages/db/src/schema.ts 中的 harnessThreads 表定义留在 db 包
   （它是数据库 schema），persistent-thread-store.ts 通过 @town/db
   导入 schema。

9. 运行 pnpm typecheck && pnpm test 确认。
10. 运行 pnpm check:build-entries 确认构建入口正常。
```

---

## 提示词 6：拆分单文件包

```
拆分以下 7 个单文件包，把 index.ts 中的类型定义和实现逻辑分到独立文件中。
每个包的拆分模式相同：types.ts 放类型/schema/error class，repository.ts
放实现，index.ts 做桶导出。

需要拆分的包（按文件大小排序）：

1. packages/channels/src/index.ts (677 行)
   → types.ts: channelKindSchema, channelStatusSchema, deliveryStatusSchema,
     ChannelKind, ChannelStatus, DeliveryStatus, NotificationChannel,
     NotificationDelivery, ClaimedNotificationDelivery, ChannelError, MAX_DELIVERY_ATTEMPTS
   → repository.ts: createChannelRepository, ChannelRepository
   → index.ts: re-export both

2. packages/content/src/index.ts (609 行)
   → types.ts: contentKindSchema, contentStatusSchema, ContentItem,
     ContentCollection, ContentShare, ContentPage, ContentRevision,
     PublicContent, ContentError
   → repository.ts: createContentRepository, ContentRepository
   → index.ts: re-export both

3. packages/operations/src/index.ts (606 行)
   → types.ts: auditOutcomeSchema, AuditOutcome, AuditEvent, AuditPage,
     TimelineItem, TimelinePage, AnalyticsEvent, AnalyticsPage,
     PublicAnalyticsReceipt, presenceSurfaceSchema, PresenceSurface,
     PresenceSession, OperationSummary, OperationsError
   → repository.ts: createOperationsRepository, OperationsRepository
   → index.ts: re-export both

4. packages/google/src/index.ts (370 行)
   → types.ts: Google API 相关类型
   → client.ts: createGoogleApiClient, Gmail/Calendar 方法实现
   → index.ts: re-export both

5. packages/suggestions/src/index.ts (333 行)
   → types.ts: suggestion schema + 类型
   → repository.ts: createSuggestionRepository, SuggestionRepository
   → index.ts: re-export both

6. packages/billing/src/index.ts (296 行)
   → types.ts: billing schema + 类型 + BillingError
   → repository.ts: createBillingRepository, BillingRepository
   → index.ts: re-export both

7. packages/a2a/src/index.ts (203 行)
   → types.ts: A2A envelope schema + 类型
   → repository.ts: createA2ARepository, A2ARepository
   → index.ts: re-export both

规则：
1. 纯文件移动 + re-export，不修改任何实现逻辑。
2. 外部消费者（apps/api 等）不需要改导入路径，因为 index.ts 保持 re-export。
3. 每拆一个包就运行 pnpm typecheck 确认。
4. 全部完成后运行 pnpm verify。
```

---

## 提示词 7：apps/web 模块化（可选，工作量大）

```
将 apps/web/ 从 3 个巨型文件（app.js 4257行, index.html 1965行, styles.css 3090行）
模块化为合理的结构。

这不是 Next.js 重写（那是另一个项目），只是把现有 vanilla JS 拆成可维护的模块。

目标结构：
  apps/web/
  ├── src/
  │   ├── main.js              # 入口，初始化 + 事件绑定
  │   ├── api.js               # fetch 封装，所有 API 调用
  │   ├── state.js             # 全局状态管理
  │   ├── views/
  │   │   ├── threads.js       # 线程列表 + 聊天视图
  │   │   ├── knowledge.js     # 知识搜索
  │   │   ├── content.js       # 内容库
  │   │   ├── people.js        # 联系人
  │   │   ├── routines.js      # 例程管理
  │   │   ├── tasks.js         # 任务
  │   │   ├── approvals.js     # 审批队列
  │   │   ├── channels.js      # 渠道配置
  │   │   ├── billing.js       # 账单
  │   │   └── squares.js       # 团队
  │   └── components/
  │       ├── modal.js         # 通用弹窗
  │       ├── toast.js         # 通知
  │       └── sidebar.js       # 侧边栏导航
  ├── styles/
  │   ├── base.css             # 变量、reset、布局
  │   ├── components.css       # 组件样式
  │   └── views.css            # 各视图样式
  └── index.html               # 精简后的 HTML 骨架

规则：
1. 用原生 ES modules（import/export），不需要引入打包工具。
2. 在 index.html 中用 <script type="module" src="src/main.js">。
3. 每个视图文件导出 init/destroy 函数，由 main.js 在路由切换时调用。
4. 拆分时保持完全相同的视觉和行为。
5. 完成后运行 pnpm check:web 确认。
```

---

## 执行顺序建议

```
提示词 1 (拆 api 目录)      → pnpm verify
提示词 2 (拆 harness-tools) → pnpm verify
提示词 3 (拆 index.ts+app.ts) → pnpm verify
提示词 4 (拆 admin-routes)  → pnpm verify
提示词 5 (修 db→harness)    → pnpm verify
提示词 6 (拆单文件包)       → pnpm verify
提示词 7 (web 模块化)       → pnpm check:web
```

每个提示词完成后 commit 一次，这样如果出问题可以回滚。
建议 commit message 格式：
refactor(api): split src/ into subdirectories
refactor(api): split harness-tools.ts by tool category
refactor(api): extract config and dependencies from index.ts
refactor(api): split admin-routes into submodules
fix(db): move harness-thread-store to harness package
refactor(pkgs): split single-file packages into types + repository
refactor(web): modularize vanilla JS into ES modules
