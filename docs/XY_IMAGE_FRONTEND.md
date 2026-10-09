# GGUU AI IMAGE 前端交接

更新于 2026-10-08。本文写给接手 `apps/web` 的开发者。它和 [`XY2API_FRONTEND_HANDOFF.md`](./XY2API_FRONTEND_HANDOFF.md)（后端接口规范）是一对：那份规定接口，这份讲前端怎么用这些接口、为什么这样做，以及还剩哪些坑。

产品背景和用户画像见 `apps/web/PRODUCT.md`，视觉方向见 `apps/web/.impeccable/surfaces/src-app-page-tsx.md`，从代码反推的设计系统（token、组件、规则）见 `apps/web/DESIGN.md`（机器可读的补充在 `apps/web/.impeccable/design.json`）。

## 一句话

站点用 xy2api 主站账号登录。生图和设计助手对话走用户自己的主站 Key，按主站价格从主站美元余额扣费。前端只保存 Supabase 会话，没有积分、套餐、支付，也没有本地注册。

## 路由

| 路径 | 作用 | 关键文件 |
| --- | --- | --- |
| `/` | 落地页：氛围屏首屏和描述输入框（未登录提交会先存提示词，再去登录）、示例作品横排、两种用法和模型列表、计费说明 | `app/page.tsx`、`components/landing/*` |
| `/login` | 主站邮箱和密码登录，支持 TOTP、Turnstile、限流倒计时、`?reason=expired` 和 `?next=` | `components/auth/login-view.tsx` |
| `/register` | 只给出主站注册链接，本站不建账号 | `app/register/page.tsx` |
| `/home` | 工作台首页：交给助手（新建画布并带上提示词）、起手式、余额和 Key 状态、最近生成、最近画布 | `app/(workspace)/home/page.tsx` |
| `/studio` | 生图：左边写描述（`composer.tsx`）和处理队列（`job-queue.tsx`），右边是氛围屏上的当前作品和信息卡（`result-stage.tsx`），下方是按天分组的全部作品（`history-grid.tsx`） | `app/(workspace)/studio/page.tsx`、`hooks/use-studio-jobs.ts`、`components/studio/*` |
| `/projects` | 画布项目列表 | `app/(workspace)/projects/page.tsx` |
| `/canvas?id=` | Excalidraw 画布、设计助手侧栏、画布内生图面板 | `app/canvas/page.tsx` |
| `/settings?tab=account\|keys\|models\|records` | 账户与余额、Key 选择、默认模型和自己的对话模型服务商（`#chat-providers`）、生成记录（计费核对） | `components/settings/*` |
| `/brand-kit`、`/skills` | 上游功能，已汉化并接入统一的错误处理 | `components/brand-kit/*`、`app/(workspace)/skills/page.tsx` |

## 状态与数据流

- **会话**：`lib/auth-context.tsx`。所有受保护请求一旦返回 401，就调用 `emitAuthExpired()`（`lib/server-api.ts`）。AuthProvider 对同一次过期只处理一次：本地退出（`signOut({ scope: "local" })`），然后跳转到 `/login?reason=expired`。WebSocket 连续两次以 4001 关闭也走同一个事件（`hooks/use-websocket.ts`）。页面里不要自己调用 `signOut` 处理 401。
- **账户**：`lib/account-context.tsx` 统一提供账户、余额、Key、图像模型和对话模型。生成结束后调用 `notifyGenerationSettled()` 刷新余额。`balance === null` 表示读不到，界面要显示「暂不可读」或「未选择 Key」，不能显示 `$0`。
- **错误**：`lib/generation-errors.ts` 是错误码目录，`components/issues/issue-provider.tsx` 负责路由。余额不足、Key 不可用、「可能已扣费」这类阻断性问题弹对话框，并只给一个能解决问题的动作（充值、去设置、去主站用量页）；临时性问题用 toast。调用方只需 `report(error)` 或 `reportCode(code, message)`，不要自己写这类文案。
- **生图任务**：`lib/image-jobs.ts` 用 `toImageJobView` 把松散的 job 记录读成视图。计费状态有 `charged`、`not_charged`、`pending`、`unknown` 四种。`pending` 在任务进行中表示「结算中」，任务结束后才算「待核对」（见 `needsReconcile(status, active)`）。已扣费但 Storage 暂时写不进去的任务是 `queued` 加 `error_code = storage_retrying`：`isSavingJob` 为真，界面显示「保存中」，不能取消，不占并发名额（`busyCount`），本页提交的任务会弹一次提示；服务端补传成功后自动变成已完成（服务端 M6）。
- **模型偏好**：图像模型偏好存在 localStorage `xy:image-model-preference`，发送前用 `resolveImagePreference()` 过滤掉当前 Key 用不了的模型；过滤后为空就回到自动。对话模型存在 `xy:agent-model`，取值是 `/api/models` 返回的 id（主站 `openai:<model>`，自己的服务商 `custom:<providerId>:<model>`），为空表示用设置里的默认；列表里已经没有的 id（换了 Key、服务商停用或删除）会自动回到默认。

## 计费安全规则（改代码前必读）

1. **生成请求只发一次。** 无论失败、组件卸载还是重新挂载，都不自动重发。生图室提交时有防连点锁；画布生图面板用模块级的 `inFlight` 集合记录进行中的请求，关闭面板不会中止请求，已扣费的结果仍会放回画布。`test/studio-jobs.test.tsx` 覆盖了这几点。
2. **未知不等于没扣费。** `upstream_unknown`、网络中断或状态不明的任务一律标「待核对」，并给出主站请求 ID 和用量页链接。画布上残留的「生成中」占位如果已经没有对应的请求，就显示「结果未知」，不会重新发送。
3. **主站的秘密不进浏览器存储。** 密码、TOTP challenge、tokenHash、主站 JWT 和 API Key 都不写入 storage，也不打印到日志（`test/login.test.tsx` 有断言）。Supabase 影子用户的 `user.email` 是合成地址，不要展示；真实邮箱从 `useAccount()` 取。用户自己服务商的 API Key 只写不读：只在添加 / 编辑弹窗的表单状态里存在，保存或关闭后丢弃，接口只返回末 4 位 `keyHint`，日志只记服务商 id 和路径（`test/chat-providers-api.test.ts` 有断言）。
4. **规格只有两档：** 1K（`standard`）和 2K（`hd`），由模型的 `maxQuality` 决定能否选 2K。没有 4K、视频、积分和支付入口。
5. **偏好的字段格式：** 偏好接口的响应是 snake_case，更新请求是 camelCase。默认对话模型写入账户偏好时用裸模型名（例如 `gpt-5.4`）加 `defaultChatProviderId`（自己的服务商 id；主站为 `null`）。10-09 起不再写工作区设置（运行时已改读账户偏好，`model-resolver.ts`）。旧服务器的偏好接口不认 `defaultChatProviderId`，所以只有响应里带 `default_chat_provider_id` 时才发这个字段（`lib/chat-models.ts` 的 `chatPreferencePatch`）。
6. **自己的服务商不走主站计费。** 用自定义服务商对话时费用由服务商收取，不从主站余额扣，界面要写明；`provider_*` 错误码一律 `maybeCharged: false`，文案不对服务商那边的扣费下任何结论。生图（生图页、画布生图、助手的生图工具）仍然只走主站。

## 自定义对话模型服务商（前端已完成，等后端）

用户 10-08 的需求：「对话模型可以用户自定义配置模型提供商」。按方案文档（`/workspace/XY-IMAGE-AGENT03-PLAN.md` 第 6 节）的默认决定 D1–D5：每个用户配自己的；只用于设计助手对话；第一版只支持 OpenAI 兼容接口；费用由服务商收；只允许 https 公网地址。接口细节以方案文档 6.4 与 6.4.1 为准。

| 部分 | 文件 | 说明 |
| --- | --- | --- |
| 模型 id 与列表 | `lib/chat-models.ts` | `parseChatModelRef` / `formatChatModelRef`（只按前两个 `:` 切，模型名可含 `:` 和 `/`）；`normalizeChatModelList` 同时接受旧的 `{ models }` 和新的合并列表（`source`、`billing`、`xy2api.available/error`）；`groupChatModels` 按「主站 / 各服务商」分组；`chatBillingNote` 计费说明；`preferredChatModelId`、`chatPreferencePatch` 处理偏好 |
| 接口客户端 | `lib/chat-providers-api.ts` | `/api/chat-providers` 增删改查与 `refresh-models`；`isEndpointMissing` 用 Fastify 默认 404（没有 `error.code`）识别还没上线这批接口的旧服务器 |
| 表单逻辑 | `lib/chat-provider-form.ts` | 地址规范化（https、不带账号密码 / 查询参数 / `#`、去掉末尾 `/`）、长度和数量上限、改地址必须重填 Key、只发改动的字段、服务端错误码落到对应输入框 |
| 设置页 | `components/settings/chat-providers-section.tsx`、`chat-provider-dialog.tsx`、`models-tab.tsx` | 列表（名称、地址、Key 末 4 位、模型数、状态）、添加 / 编辑弹窗、刷新模型、启用开关、删除二次确认；默认对话模型选择器按来源分组并显示计费说明；停用默认模型所在的服务商时提示换默认；旧服务器显示「服务器暂时还不支持」，不报错 |
| 画布选择器 | `components/agent-model-selector.tsx` | 有自己的服务商时按来源分组；选中服务商模型时图标换成插头，读屏文字带计费说明 |
| 错误 | `lib/generation-errors.ts`、`issues/issue-provider.tsx`、`chat-sidebar.tsx` | 8 个 `provider_*` 码有文案；设置类问题弹窗并给「检查服务商设置」（跳 `/settings?tab=models#chat-providers`）；`run.failed` 带 `provider_*` 码时进问题中心，`provider_model_not_found` 顺带刷新模型列表 |
| 通用组件 | `ui/select.tsx`（选项分组）、`ui/switch.tsx`、`settings/section.tsx`（`Tag`、锚点 `id`） | — |

测试：`test/chat-models.test.ts`、`chat-provider-form.test.ts`、`chat-providers-api.test.ts`、`chat-providers.test.tsx`、`chat-providers-section.test.tsx`。预览假接口在 `/workspace/xy-preview/server.mjs`（`PROVIDERS=off` 模拟旧服务器；地址里含 `badkey` 返回 `provider_auth_failed`，含 `nolist` 返回 `provider_models_unavailable`（手动填了模型则按手动保存），含 `localhost`、`10.0.`、`192.168.` 返回 `provider_blocked_address`）。

## 视觉系统

方向是「夜色光场」（2026-10-08 用户选定，替换了第一版「暗房接触印样」）：深墨蓝的夜色房间，当前这张图放大、高斯模糊后铺成整页的环境光，图本身像一块微微侧转的屏幕挂在房间里，地面有一条淡光带和倒影。品牌名 GGUU AI IMAGE，字标是 GGUU 粗体加描边小标签 AI IMAGE。文案直白亲切，不用暗房、冲印、显影这类行话。不用琥珀或黄色铺色。

- **环境光**：`components/ambient/ambient-provider.tsx`。页面调用 `useAmbientImage(src, preset?)` 点亮房间：传 `undefined` 表示保持当前的光（数据还在加载时用），传 `null` 表示回到默认光。`lib/ambient-color.ts` 从图片取两种主色，GSAP 把它们补间写到 `<html>` 的 `--amb` / `--amb-2`（「R G B」三元组），按钮光晕、焦点环、品牌图标、状态点都跟着变色。客户端跳转时光会保留，房间保持最后看过那张图的颜色。`<AmbientField />` 是固定在视口后面的模糊图层。
- **氛围屏**：`components/ambient/light-screen.tsx`，倾斜的大图、地面倒影、换图时先亮后落的过渡；指针设备上会轻微朝向光标。`reveal-image.tsx` 用于新结果到达时的「点亮」效果。减少动态时都直接显示最终状态。
- **Token** 在 `app/globals.css`：`ground-deep` #060912、`ground` #0a0f1e、`panel` #131b31、`well` #0e1528、`fg` / `fg-soft` / `fg-muted`、`line` / `line-strong`（白色低透明度）、`alert` 珊瑚红 #ff8a80（异常）、`ok` 绿 #5ee0b4、`amb` / `amb-2`（随图片变化）。shadcn 的语义 token 已映射到这一套，`ThemeProvider` 固定为 dark。
- **材质**：`glass`（漂浮控件、面板）和 `glass-strong`（压在图片上的信息卡、输入框）；`prefers-reduced-transparency` 时退回实色。`glow-amb` 是主按钮的环境光晕，`shadow-lit` 是图片的受光阴影。按钮的 `glow` 变体是近白主按钮。
- **字体**（`app/layout.tsx`、`app/display-font.css`）：标题用 GGUU Display（得意黑 Smiley Sans 的子集，`font-display`），正文用 Geist + Noto Sans SC，数据用 Geist Mono。
- **圆角**：控件 6–10px，卡片 14–18px，大面板 20–22px，导航和标签是胶囊形。
- **布局**：已登录页面共用 `app/(workspace)/layout.tsx`：顶部吸顶导航（`components/app-sidebar.tsx`，名字沿用上游；手机端是底部浮动栏），页面在文档上滚动，内容容器统一 `max-w-[1600px]`。
- 品牌名集中在 `lib/brand.ts`；图标在 `components/brand/brand-mark.tsx`。`public/` 下的 favicon、logo、apple-touch-icon、og-image 由 `scripts/generate-brand-assets.mjs` 生成，用法（字体目录、sharp 路径）写在脚本头部。改了图标要同步脚本里的几何。
- 在 `<a>` 上用按钮样式时，直接用 `buttonVariants()`（已经过 tailwind-merge）。不要给 Base UI 的 `Button` 传 `render={<a/>}`。
- **画布主题**：画布用 Excalidraw 深色主题，主题统一从 `hooks/use-canvas-theme.ts` 取。注意 next-themes 的 `resolvedTheme` 不理会 `forcedTheme`（会一直返回 `light`），所以要读 `forcedTheme ?? resolvedTheme`。深色主题靠 CSS 滤镜 `invert(93%) hue-rotate(180deg)` 反相画布，位图会再反相回来，颜色正确；默认白底显示为中性黑 #121212。缩略图和给设计助手的画布截图走 `exportToBlob`，没有设 `exportWithDarkMode`，导出仍是浅色。背景色选择器的色块套用同一个滤镜（`CANVAS_DARK_FILTER`），看到的就是画布上的颜色，存的 hex 不变。
- **画布图片**（`lib/canvas-files.ts`）：服务端把画布图片存在 `project-assets/<工作区>/canvas-files/<画布>/<文件 ID>.<扩展名>`，读取时只给 `storageUrl`，前端下载后转成 Excalidraw 需要的 data URL。保存时只有服务端还没有的文件带 `dataURL`，其余只带 ID 和类型，服务端沿用已存的那份；所以自动保存和关页时的 keepalive（上限 64 KiB）不再带整张图。保存响应里的 `missingFileIds` 是画面上用到、但服务端没有数据的文件（比如另一个标签页的保存把它丢了），编辑器会带数据重发，每个文件最多 2 次。Agent 插入的图是指向生成结果的标记，`canvas.sync` 时只下载编辑器还没有的文件。2026-10-09 之前的画布图片是 base64 存在 `canvases.content` 里的，下次保存时自动转存。保存请求还带 `deletedElementIds`（`lib/canvas-save.ts`）：只列用户删掉的、服务端放上来的图（`customData.jobId`），服务端据此保留页面还没加载的新图。`canvas.sync` 和任务轮询拉到服务端画布后用 Excalidraw 的 `reconcileElements` 合并（本地版本更新的、本地删掉的、只在本地的都保留），不再整份替换。Agent 工具结果带 `pending: "storage"`（图片在补传）时，`use-job-fallback-polling` 每 15 秒查一次任务，最长 90 分钟；超时的任务仍是 5 秒一次、最长 10 分钟。对话里这两种情况不显示“图片生成失败”，而是“图片已生成，正在保存”或“图片还在生成”，说明好了会自动放到画布上（`tool-block-view.tsx`）。画布生图面板和前端放置的助手出图经 `/api/proxy-image` 读取生成结果（`fetchAsDataURL`）：这个接口只读本站 Storage（`SUPABASE_URL` 下 `/storage/v1/object/public|sign/` 的 png/jpeg/webp/gif，25 MB 以内），别的地址一律 403。
- **画布手机端**：<640px 时品牌套件选择器和设计助手按钮都只显示图标（选择器用 Base UI 菜单，自动避开屏幕边缘），；缩放条移到工具栏上方；画布内生图面板贴底全宽停靠（桌面端放不下时会翻到占位框上方）。

## 测试与构建

```bash
export PATH=$HOME/.local/bin:$PATH
cd apps/web
npx tsc -p tsconfig.json --noEmit
npx vitest run                     # 24 个文件，140 个用例
cd ../.. && pnpm --filter @loomic/web build   # 静态导出到 apps/web/out
```

`test/setup.ts` 为 jsdom 补了 `matchMedia`。日志统一用 `[模块]` 前缀，例如 `[image-gen]`、`[studio]`、`[landing]`、`[ambient]`、`[auth]`、`[brand-kit]`、`[skills]`、`[canvas]`、`[chat-provider]`、`[settings]`、`[account]`、`[fonts]`，线上排查时可以按前缀过滤控制台。

## 已移除的上游内容

- **视频生成、积分、套餐、Lemon Squeezy 支付、本地注册、定价页**：主站计费模型下不存在这些功能。
- **首页灵感库**（`home-example-*`、`home-discovery-*`）：内容镜像自第三方站点（Lovart），包括英文和视频提示词、伪造的互动数，图片外链到上游 Supabase 项目 `jmcrxgenontlkxktpihl`，版权和可用性都不可控。前端已删除；**对应的 Supabase 表和迁移仍在**，需要的话由后端决定是否清理。
- **Loomic 品牌**：界面里已经没有 Loomic 字样。`@loomic/*` 包名和后端的 `LOOMIC_*` 环境变量没有改，避免影响构建和部署。

## 后端缺口与待确认事项

| 事项 | 现状 | 建议 |
| --- | --- | --- |
| 默认对话模型 | **已解决**：运行时读账户偏好（`model-resolver.ts`） | 10-09 agent01 删掉了前端双写和 `workspaceModel`，模型 id 解析改用 shared 的 `parseChatModelRef` |
| 自定义对话模型服务商 | 前端已按方案 6.4 / 6.4.1 完成；后端接口、表、加密、SSRF 防护、运行时都还没做 | agent03 实现方案第 6 节；`provider_*` 错误码要加进 `@loomic/shared` 的 `errorCodeValues`，`run.failed` 才能带出来；`parseChatModelRef` 进 shared 后前端改为复用（`lib/chat-models.ts` 有 TODO） |
| Key 额度单位 | `quota` 和 `quotaUsed` 按美元显示，`quota <= 0` 显示为「额度不限」 | 和主站确认单位（`keys-tab.tsx` 里有 TODO） |
| 示例图版权 | `public/images/showcase/` 中 3/8/9/12 已换成 Unsplash License 图片（出处见 `components/landing/showcase.ts`）；其余 8 张继承自上游，来源未核实 | 上线前把其余 8 张换成本站生成或有授权的图 |
| Google Fonts | 前端已改为先走后端代理 `GET {API}/api/fonts/css2?family=&text=`（`lib/font-api.ts` 的 `loadFontStylesheet`），代理样式表加载失败时回退直连 `fonts.googleapis.com`；代理在本页成功过一次之后，单个字体失败只回退这一个。字体库预览只取字体名用到的字形（`text=`），品牌字体卡片加载完整字体；同一字体加载过完整版后不再追加子集（子集的 @font-face 没有 unicode-range，会盖住完整版）。**后端代理还没做**（agent03，方案文档第 5 节），上线前国内网络仍会走回退 | 后端实现 `/api/fonts/css2` 与 `/api/fonts/files/*`；字体文件跨域加载需要 CORS 头 |
| P1 功能 | 单张价格预估、一键创建 Key、主站嵌入登录都还没做 | 后端接口就绪前，界面上不出现这些入口 |
| 起手式 | `lib/starter-prompts.ts` 里是写死的六个中文起手式 | 以后改成运营可配置 |

## 本地预览（不依赖后端）

视觉验收时，可以把站点构建到一个假的 API 地址，再在 localStorage 里注入一个未过期的 Supabase 会话（键名是 `sb-<host 第一段>-auth-token`），这样不连后端也能看到登录后的页面。本次验收用的就是这种方式，截图在 `apps/web/.impeccable/review/`。假数据服务没有提交进仓库，以免被误当成真实接口。
