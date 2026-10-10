# GGUU AI IMAGE 前端交接

更新于 2026-10-10（第三版界面 F2、节点画布）。本文写给接手 `apps/web` 的开发者。它和 [`XY2API_FRONTEND_HANDOFF.md`](./XY2API_FRONTEND_HANDOFF.md)（后端接口规范）是一对：那份规定接口，这份讲前端怎么用这些接口、为什么这样做，以及还剩哪些坑。

产品背景和用户画像见 `apps/web/PRODUCT.md`，视觉方向见 `apps/web/.impeccable/surfaces/src-app-page-tsx.md`，从代码反推的设计系统（token、组件、规则）见 `apps/web/DESIGN.md`（机器可读的补充在 `apps/web/.impeccable/design.json`）。**注意**：DESIGN.md 和 design.json 还是第二版「夜色光场」，F2 做完后重写；在那之前以 `app/globals.css` 顶部注释和方向合同为准。

## 一句话

站点用 xy2api 主站账号登录。生图和设计助手对话走用户自己的主站 Key，按主站价格从主站美元余额扣费。前端只保存 Supabase 会话，没有积分、套餐、支付，也没有本地注册。

## 路由

| 路径 | 作用 | 关键文件 |
| --- | --- | --- |
| `/` | 落地页：氛围屏首屏和描述输入框（未登录提交会先存提示词，再去登录）、示例作品横排、两种用法和模型列表、计费说明 | `app/page.tsx`、`components/landing/*` |
| `/login` | 主站邮箱和密码登录，支持 TOTP、Turnstile、限流倒计时、`?reason=expired` 和 `?next=` | `components/auth/login-view.tsx` |
| `/register` | 只给出主站注册链接，本站不建账号 | `app/register/page.tsx` |
| `/home` | 工作台首页：交给助手（新建画布并带上提示词）、起手式、余额和 Key 状态、最近生成、最近画布 | `app/(workspace)/home/page.tsx` |
| `/studio` | 生图：左边是设置（`composer.tsx`：模型、提示词和「优化提示词」、参考图、比例、画质、质量、张数），中间是按请求分组的结果（`batch-feed.tsx`，一次多张的每张单独显示状态），右边是记录栏（`history-rail.tsx`），大图和详情在 `loupe-dialog.tsx`，局部重绘和扩图在 `edit-dialog.tsx` | `app/(workspace)/studio/page.tsx`、`hooks/use-studio-jobs.ts`、`components/studio/*` |
| `/projects` | 画布项目列表 | `app/(workspace)/projects/page.tsx` |
| `/canvas?id=` | 节点画布（React Flow）：提示词卡片、生成节点、图片、文字、形状、画框；右侧设计助手 | `app/canvas/page.tsx`、`components/node-canvas/*`、`lib/node-canvas/*` |
| `/settings?tab=account\|keys\|models\|records` | 账户与余额、Key 选择、默认模型和自己的对话模型服务商（`#chat-providers`）、生成记录（计费核对） | `components/settings/*` |
| `/brand-kit`、`/skills` | 上游功能，已汉化并接入统一的错误处理 | `components/brand-kit/*`、`app/(workspace)/skills/page.tsx` |

## 状态与数据流

- **会话**：`lib/auth-context.tsx`。所有受保护请求一旦返回 401，就调用 `emitAuthExpired()`（`lib/server-api.ts`）。AuthProvider 对同一次过期只处理一次：本地退出（`signOut({ scope: "local" })`），然后跳转到 `/login?reason=expired`。WebSocket 连续两次以 4001 关闭也走同一个事件（`hooks/use-websocket.ts`）。页面里不要自己调用 `signOut` 处理 401。
- **账户**：`lib/account-context.tsx` 统一提供账户、余额、Key、图像模型和对话模型。生成结束后调用 `notifyGenerationSettled()` 刷新余额。`balance === null` 表示读不到，界面要显示「暂不可读」或「未选择 Key」，不能显示 `$0`。
- **错误**：`lib/generation-errors.ts` 是错误码目录，`components/issues/issue-provider.tsx` 负责路由。余额不足、Key 不可用、结果待核对这类阻断性问题弹对话框，并只给一个能解决问题的动作（充值、去设置、去主站用量页）；临时性问题用 toast。调用方只需 `report(error)` 或 `reportCode(code, message)`，不要自己写这类文案。
- **生图任务**：`lib/image-jobs.ts` 用 `toImageJobView` 把松散的 job 记录读成视图。计费状态有 `charged`、`not_charged`、`pending`、`unknown` 四种。`pending` 在任务进行中只是还没结算，任务结束后才算「待核对」（见 `needsReconcile(status, active)`）。界面只用 `billingFlag` 标两种：「待核对」和「未发出」，`charged` / `not_charged` 不显示标签（见下面第 7 条）。已扣费但 Storage 暂时写不进去的任务是 `queued` 加 `error_code = storage_retrying`：`isSavingJob` 为真，界面显示「保存中」，不能取消，不占并发名额（`busyCount`），本页提交的任务会弹一次提示；服务端补传成功后自动变成已完成（服务端 M6）。
- **局部重绘 / 扩图**（M-G，2026-10-10）：从结果卡片的工具条或大图弹窗打开 `components/studio/edit-dialog.tsx`，只对已经出图的那张做，一次只改一张原图。局部重绘在 `mask-painter.tsx` 上涂：遮罩画布和原图同尺寸（长边最多 2048），画笔 / 擦除 / 撤销 / 重做 / 清空，`[` `]` 调笔刷，鼠标、触控笔和手指都能用；提交时把涂抹层导出成 PNG（不透明 = 要改），经 `/api/uploads` 上传，任务带 `edit: { mode: "inpaint", mask }`。扩图选新比例、放大倍数（不放大 / 1.25 / 1.5 / 2）和原图位置（九宫格），预览按 `@loomic/shared` 的 `outpaintFrame` 画出新画框，任务带 `edit: { mode: "outpaint", scale, anchor }`，补出来的画面由服务端按厂商做（`apps/server/src/generation/mask-edit.ts`：OpenAI 发真遮罩，Gemini 发高亮副本或灰框图）。只列 `/api/image-models` 里 `maskEdit: true` 的模型；当前 Key 一个都没有时不显示入口。涂得太少、画框没有多出画面、模型不支持、多于一张原图这几种情况在发出前就拦下（服务端同样再查一次，不扣费）。每张单独发一次，不自动重发。结果卡片的说明行和大图详情会标「局部重绘」「扩图」。
- **模型偏好**：图像模型偏好存在 localStorage `xy:image-model-preference`，发送前用 `resolveImagePreference()` 过滤掉当前 Key 用不了的模型；过滤后为空就回到自动。对话模型存在 `xy:agent-model`，取值是 `/api/models` 返回的 id（主站 `openai:<model>`，自己的服务商 `custom:<providerId>:<model>`），为空表示用设置里的默认；列表里已经没有的 id（换了 Key、服务商停用或删除）会自动回到默认。

## 计费安全规则（改代码前必读）

1. **生成请求只发一次。** 无论失败、组件卸载还是重新挂载，都不自动重发。生图室提交时有防连点锁（`test/studio-jobs.test.tsx`）。画布的生成节点点一次发一个批量请求，请求在路上时节点锁定（`lib/node-canvas/runtime.ts`）；每张图由 Worker 放进生成节点预留的位置，关掉页面也不丢、不重发。
2. **未知不等于没扣费。** `upstream_unknown`、网络中断或状态不明的任务一律标「待核对」，并给出主站请求 ID 和用量页链接。画布上生成节点的占位只跟着任务状态显示：结果不明的写「结果未知，请先核对用量」，已生成但没放上画布的写「已生成，没放到画布上」并给生图页入口，都不会重新发送。
3. **主站的秘密不进浏览器存储。** 密码、TOTP challenge、tokenHash、主站 JWT 和 API Key 都不写入 storage，也不打印到日志（`test/login.test.tsx` 有断言）。Supabase 影子用户的 `user.email` 是合成地址，不要展示；真实邮箱从 `useAccount()` 取。用户自己服务商的 API Key 只写不读：只在添加 / 编辑弹窗的表单状态里存在，保存或关闭后丢弃，接口只返回末 4 位 `keyHint`，日志只记服务商 id 和路径（`test/chat-providers-api.test.ts` 有断言）。
4. **画质和质量是两个参数：** 画质是输出尺寸档位 1K / 2K / 4K，主站按档计价；质量是 自动 / 低 / 中 / 高，自动表示不传、由厂商决定。每个模型能选什么来自 `/api/image-models` 的 `resolutions`、`qualities`、`aspectRatios`、`maxRatio`（旧服务器只发 `maxQuality` 时由 `lib/image-model-meta.ts` 补齐）。前端和后端都用 `@loomic/shared` 的 `resolveImageParams` 算实际发送值，所以界面显示的就是会发出去的；比如 OpenAI 的 16:9 在 1K 做不出来（见 `maxRatio`），1K 会禁用并按 2K 发送。旧记录的 `quality: standard / hd / ultra` 按 `LEGACY_IMAGE_PARAMS` 读成 1K 低 / 2K 中 / 4K 自动，显示时质量为空。没有视频、积分和支付入口。
5. **偏好的字段格式：** 偏好接口的响应是 snake_case，更新请求是 camelCase。默认对话模型写入账户偏好时用裸模型名（例如 `gpt-5.4`）加 `defaultChatProviderId`（自己的服务商 id；主站为 `null`）。10-09 起不再写工作区设置（运行时已改读账户偏好，`model-resolver.ts`）。旧服务器的偏好接口不认 `defaultChatProviderId`，所以只有响应里带 `default_chat_provider_id` 时才发这个字段（`lib/chat-models.ts` 的 `chatPreferencePatch`）。
6. **自己的服务商不走主站计费。** 用自定义服务商对话时费用由服务商收取，不从主站余额扣（10-10 起界面不再写这句，见第 7 条）；`provider_*` 错误码一律 `maybeCharged: false`，文案不对服务商那边的扣费下任何结论。生图（生图页、画布的生成节点、助手的生图工具）仍然只走主站。
7. **界面少说付费**（用户 2026-10-10 两次要求）。不出现「已扣费」「不收费」；成功的图不标计费状态，只有「待核对」「未发出」两种标记；失败只说发生了什么（「没生成出来」「内容未通过审核」），不说收没收钱；可能已生成的写「结果未知，请先核对用量」「图片可能已经生成」，并给主站用量页入口。生图页、画布、设置这些工作界面不放「按次从主站余额支付」一类说明，落地页只保留一节「计费说明」；余额、用量链接和待核对的引导照常保留。服务端 `gatewayMessages`（`apps/server/src/features/xy2api/errors.ts`）会直接显示给用户，同样遵守；设计助手的系统提示也要求它不提扣费、收费、计费。

## 自定义对话模型服务商

用户 10-08 的需求：「对话模型可以用户自定义配置模型提供商」。前后端都已完成：后端由 agent03 实现（`apps/server/src/http/chat-providers.ts`、`features/chat-providers/`：Key 加密存储、只允许 https 公网地址的 SSRF 防护、运行时按偏好选服务商），`provider_*` 错误码在 `@loomic/shared` 的 `errorCodeValues` 里。按方案文档（`/workspace/XY-IMAGE-AGENT03-PLAN.md` 第 6 节）的默认决定 D1–D5：每个用户配自己的；只用于设计助手对话；第一版只支持 OpenAI 兼容接口；费用由服务商收；只允许 https 公网地址。接口细节以方案文档 6.4 与 6.4.1 为准。

| 部分 | 文件 | 说明 |
| --- | --- | --- |
| 模型 id 与列表 | `lib/chat-models.ts` | `parseChatModelRef` / `formatChatModelRef`（只按前两个 `:` 切，模型名可含 `:` 和 `/`）；`normalizeChatModelList` 同时接受旧的 `{ models }` 和新的合并列表（`source`、`billing`、`xy2api.available/error`）；`groupChatModels` 按「主站 / 各服务商」分组；`preferredChatModelId`、`chatPreferencePatch` 处理偏好 |
| 接口客户端 | `lib/chat-providers-api.ts` | `/api/chat-providers` 增删改查与 `refresh-models`；`isEndpointMissing` 用 Fastify 默认 404（没有 `error.code`）识别还没上线这批接口的旧服务器 |
| 表单逻辑 | `lib/chat-provider-form.ts` | 地址规范化（https、不带账号密码 / 查询参数 / `#`、去掉末尾 `/`）、长度和数量上限、改地址必须重填 Key、只发改动的字段、服务端错误码落到对应输入框 |
| 设置页 | `components/settings/chat-providers-section.tsx`、`chat-provider-dialog.tsx`、`models-tab.tsx` | 列表（名称、地址、Key 末 4 位、模型数、状态）、添加 / 编辑弹窗、刷新模型、启用开关、删除二次确认；默认对话模型选择器按来源分组；停用默认模型所在的服务商时提示换默认；旧服务器显示「服务器暂时还不支持」，不报错 |
| 画布选择器 | `components/agent-model-selector.tsx` | 有自己的服务商时按来源分组；选中服务商模型时图标换成插头 |
| 错误 | `lib/generation-errors.ts`、`issues/issue-provider.tsx`、`chat-sidebar.tsx` | 8 个 `provider_*` 码有文案；设置类问题弹窗并给「检查服务商设置」（跳 `/settings?tab=models#chat-providers`）；`run.failed` 带 `provider_*` 码时进问题中心，`provider_model_not_found` 顺带刷新模型列表 |
| 通用组件 | `ui/select.tsx`（选项分组）、`ui/switch.tsx`、`settings/section.tsx`（`Tag`、锚点 `id`） | — |

测试：`test/chat-models.test.ts`、`chat-provider-form.test.ts`、`chat-providers-api.test.ts`、`chat-providers.test.tsx`、`chat-providers-section.test.tsx`。预览假接口在 `/workspace/xy-preview/server.mjs`（`PROVIDERS=off` 模拟旧服务器；地址里含 `badkey` 返回 `provider_auth_failed`，含 `nolist` 返回 `provider_models_unavailable`（手动填了模型则按手动保存），含 `localhost`、`10.0.`、`192.168.` 返回 `provider_blocked_address`）。

## 视觉系统

方向是第三版「海报 · 柔和版」（F2，2026-10-10 用户选定，替换第二版「夜色光场」，方向合同见 `apps/web/.impeccable/surfaces/src-app-page-tsx.md`）：页面像一个有光的房间，墙面过渡到地面，当前那张图的颜色淡淡地染满房间；石墨色的字，唯一的强调色是珊瑚，用在每屏最要紧的那个动作上；选项和主按钮是带小圆角的斜切形。品牌名 GGUU AI IMAGE。文案直白，不用行话；不用琥珀或黄色铺色，不做硬黑边、纯黑白的刺眼海报。

- **亮暗主题**：next-themes（`components/providers.tsx`）默认跟随系统，可以手动切换并记住。`:root` 是亮色，`.dark` 换同一套名字。组件只用语义 token，不写死白色和黑色；`tint` 是叠加色（亮色下是墨色，暗色下是近白），写成 `bg-tint/[0.05]` 这类。压在照片上的文字两种主题都用白字加遮罩。
- **Token**（`app/globals.css`，顶部注释讲了规则）：墙 `wall` / `wall-2`、地面 `floor`、面板 `panel`、文字 `fg` / `fg-soft` / `fg-muted`、线 `line` / `line-strong`；强调色珊瑚 `acc`（亮色 #e5533d，暗色 #ff8068 配深色字）；`warn`（橙）用于待核对，`alert`（深红，和珊瑚分开）用于失败，`ok` 绿；都配文字，不单靠颜色。`amb` / `amb-2` 是当前图片的环境色（`components/ambient/ambient-provider.tsx` 取色后由 GSAP 补间写到 `<html>`）。
- **形状与材质**：`sk` / `sk-in` / `sk-frame` 是斜切形（按钮、页签、贴纸、斜切大图）；卡片和面板 16px 圆角。`glass`（漂浮在画面上的控件和面板）和 `glass-strong`（菜单、弹窗），`prefers-reduced-transparency` 时退回实色。阴影带偏移和模糊，颜色压向房间的石墨色，不用纯黑。
- **字体**（`app/layout.tsx`、`app/display-font.css`）：标题和主按钮用 GGUU Display（优设标题黑的子集，`font-display`），张数、计时、余额这类大数字用 Big Shoulders Display（`numeral`），正文 Geist + Noto Sans SC，数据用 Geist Mono（`data-label`）。
- **布局**：已登录页面共用 `app/(workspace)/layout.tsx`：顶部导航（`components/app-sidebar.tsx`，名字沿用上游；手机端是底部浮动栏），内容容器 `max-w-[1600px]`。
- 品牌名集中在 `lib/brand.ts`；图标在 `components/brand/brand-mark.tsx`。`public/` 下的 favicon、logo、apple-touch-icon、og-image 由 `scripts/generate-brand-assets.mjs` 生成，用法（字体目录、sharp 路径）写在脚本头部。改了图标要同步脚本里的几何。
- 在 `<a>` 上用按钮样式时，直接用 `buttonVariants()`（已经过 tailwind-merge）。不要给 Base UI 的 `Button` 传 `render={<a/>}`。
- **动效**：每个动效在 `prefers-reduced-motion` 下都直接显示最终状态（GSAP 用 `gsap.matchMedia`，CSS 动画在 globals.css 统一关闭）。
- **账户页面**（M-F，2026-10-10）：设置、品牌套件、技能三页的分类都用 `components/ui/poster-tabs.tsx`（`PosterTabs` + `posterPanelProps`）：斜切页签，当前页签是墨色，和顶部导航一致；有完整的 tab 语义，←/→ 切换，Home/End 跳到两头。分组标题用 `poster-label`（设置的 `SettingsSection`、品牌套件的 `SectionHeader`）。品牌套件有了页头，加载和出错时也保留页头（`BrandKitFrame`），套件列表、色块、字体和图片格子都是 14px 圆角的面板，添加格子悬停时变珊瑚色；空状态和「添加自定义技能」用落地页同款的珊瑚贴纸图标和珊瑚斜切按钮。技能卡片用「名字按钮 + `::after` 盖住整张卡」的写法，整张卡可点、开关和菜单仍是独立控件，键盘也能用；市场卡片本身就是按钮。输入框统一是 `bg-tint/[0.06]`，聚焦时珊瑚内描边。
- **设计助手侧栏**（M-E，2026-10-10）：标题用 `poster-label`（「/ 设计助手」）；用户消息是墨色气泡（`bg-fg text-ground`），里面的提及和图片小标签跟随 `currentColor`；助手文字不加底，流式光标是珊瑚色。输入框和生图页的提示词框一样：凹下去的 `well` 底，聚焦时珊瑚描边；发送是珊瑚斜切按钮，停止是墨色斜切按钮。空对话的起步建议是斜切小标签。工具卡片都是 14px 圆角：生成中沿用生图页的斜纹 + 往复进度条；出图卡片在图放到画布上（输出里有 `elementId`）时盖一个落地页同款的珊瑚贴纸「已放到画布」，流式时盖章动一下，历史消息和减少动效时直接显示。没出图的卡片按 `components/chat/media-outcome.ts` 判断，规则和生图页 `describeOutcome` 一致：任务说没扣费才写「没生成出来」加原因；没有账单状态（旧消息、工具抛错）、待结算或可能扣费的码都写「结果待核对 / 图片可能已经生成」，橙色底，带「打开生成记录」（`/settings?tab=records`，新标签页）。服务端在工具输出里带 `errorCode`、`billingStatus`（`apps/server/src/agent/runtime.ts` 的 `settledFailure`）。页头、收起时的打开按钮和断线提示在 `components/chat/chat-panel-chrome.tsx`。

## 节点画布

`/canvas` 是自己写在 React Flow 12（`@xyflow/react`，MIT，右下角的署名保留）上的节点画布，2026-10-10 替换了 Excalidraw。

- **存储格式不变**：画布内容仍是 `{ elements, appState, files }`，节点就是元素，两端都绑定了元素的 `arrow` 显示成连线。服务端的保存合并、文件转存、没看到的图保留、清扫、设计助手的 inspect / manipulate 工具和旧画布都不用迁移。编辑器不认识的元素原样保留、不显示，保存时照写回去；旧画布的 `image-generator` 占位读成生成节点，freedraw 读成线条。
- **代码结构**：`lib/node-canvas/` 是不依赖 React 的部分：`adapter.ts`（元素 ⇄ 节点和连线）、`store.ts`（一块画布一个 store，React Flow 受控于它）、`merge.ts`（合并服务端的副本：同一 id 版本高的赢，平局留页面的，页面删掉的不复活）、`history.ts`（撤销只撤自己的操作，Worker 放上来的图和设计助手的改动不会被撤掉）、`runtime.ts`（生成节点的请求和任务跟踪）、`layout.ts`（出图位置）、`render.ts`（缩略图和给设计助手的截图用的 2D 渲染）。`components/node-canvas/` 是编辑器、各种节点、工具栏、图层和「生成的图片」面板、保存状态。日志前缀 `[node-canvas]`、`[node-canvas/runtime]`。
- **节点和工具**：左侧工具栏：选择 V、拖动画布 H、提示词卡片 P、生成节点 G、上传图片 U（也可以粘贴、拖进来）、文字 T、画框 F、撤销 ⌘Z、重做 ⇧⌘Z / ⌘Y，⌘D 复制，⌘A 全选；图层面板能锁定节点（锁定后不能拖动和删除），「生成的图片」面板列出生成节点、设计助手和生图页放上来的图（不含上传的），可以定位和下载。删除键由编辑器自己处理（`deleteKeyCode={null}`）：React Flow 内部的选中状态比受控的 props 晚一拍，刚用 ⌘A 选中就按删除会删不掉。
- **生成节点**：连到它的提示词卡片和文字按从上到下的顺序拼在它自己的描述前面，连到它的图片作参考图（只在页面上的先上传）。点一次「生成 N 张」发一个批量请求（`/api/jobs/image-generation/batch`，带 `canvas_id`、`canvas_source_id` 和每张图的位置 `canvas_slots`），请求在路上时节点锁定，不自动重发。每张图由 Worker 放进预留的位置，并加一条生成节点 → 图的连线；页面每 4 秒查一次任务状态，有任务结束就拉一次画布。生成节点还没保存上时 Worker 不加连线，图到了以后页面自己补上（`store.linkRunPictures`）。
- **保存**：最后一次改动 1.5 秒后保存，只带服务端还没有的文件数据（`lib/canvas-files.ts`、`lib/canvas-save.ts`），删掉的服务端放上来的图作为 `deletedElementIds` 发送；`missingFileIds` 里的文件带数据重发，每个最多 2 次；关页面时用 keepalive 发出没保存的改动（上限 64 KiB，所以不带文件数据）。保存失败按 5 秒起、最长 60 秒退避重试，网络恢复（`online`）或拉到服务端的画布时立刻再试。页头显示「已保存」「正在保存」「还没保存上，正在重试」（`save-status.tsx`）。
- **同步**：`canvas.sync`（设计助手改了画布）和任务结束时，页面拉服务端的画布交给 `store.mergeRemote` 合并，不整份替换；只下载页面还没有的文件。服务端画布图片的存放规则没变：`project-assets/<工作区>/canvas-files/<画布>/<文件 ID>.<扩展名>`，节点直接用 `storageUrl` 显示；生成的图是指向生成记录的标记。
- **主题**：React Flow 的 `colorMode` 跟随站点主题（`hooks/use-canvas-theme.ts`；next-themes 的 `resolvedTheme` 不理会 `forcedTheme`，所以读 `forcedTheme ?? resolvedTheme`）。缩略图和截图用同一主题的配色（`RENDER_PALETTES`）。
- **手机**：窄于 `md` 时隐藏小地图，缩放条贴左下；空白画布的提示在手机和平板上指向右上角的对话按钮和左边工具栏的「生成节点」，桌面才提示按 C、按 G（`canvas-empty-hint.tsx`）。手机上的关键路径有实验环境端到端（`08-mobile.mjs`，390×844 触屏）。
- **实验环境端到端**：`04-canvas-files.mjs`（上传、旧画布、设计助手出图、生成节点出图和连线、删除后清理）、`05-late-delivery.mjs`、`06-chat.mjs`、`08-mobile.mjs`。
- **设计助手对话**（`components/chat-sidebar.tsx`）：WebSocket 没连上时不能发送（按钮不可用，文字留在输入框里；首次连接超过 1.5 秒才显示“正在连接…”，断线后显示“连接已断开，正在重连”）。`startRun` 返回命令有没有发出去；发出的那一刻正好断线时，消息从对话里撤回、文字放回输入框，并提示没有发出。用户消息和自动标题在运行请求发出后才保存。2026-10-09 之前页面刚打开就发送的消息会被悄悄丢掉：命令没发出去，重连后重新读消息又把“没有收到回复”的提示也冲掉了。运行中发送按钮变成“停止”（`chat-input.tsx`），点了发 `agent.cancel`；还没拿到运行 ID 时先记下，拿到就发。服务端以 `run.canceled` 结束，`use-chat-stream` 把还在跑的工具标成已停止（`output.stopped`，和服务端保存的消息一致，刷新后也一样）；什么都还没回来时显示“已停止。”（服务端保存同一行，`RUN_STOPPED_TEXT`，刷新后还在）。停在生图途中：Worker 还没取走的任务直接取消，不扣费；已经发出的照常生成，Worker 放到画布上，卡片写“已经开始生成的图片仍会放到画布上”。运行失败时：主站拒绝的（`run.failed` 的 `details.gatewayCode`，比如内容审核、余额不足、Key 不可用）交给问题中心，对话里写“没能完成：<原因>”；其他失败写“抱歉，处理过程中遇到问题，请重试。”。这一行由 `@loomic/shared` 的 `runFailureText` 生成，服务端保存消息时用同一行，刷新后还在。断线期间服务端结束了运行时，重连后服务端补发缓存的事件，页面照常结束这次运行；服务端已经没有这次运行（进程被强杀，或缓存过期）时，等 3 秒补发后仍没结束就在本地结束：已保存的回复照常显示，没保存的写“连接断开期间这条回复没有完成，不会自动重发。需要的话可以再发一次。”（只在页面上，不保存），并按失败的运行去查画布上还在生成的图（`RunLostError`）。画布页在打开时和对话停止或失败 3 秒后，会查这块画布还在生成的图（`watchCanvasJobs`），轮询到完成就同步画布，停止后还有图在路上时提示“还有 N 张图在生成，好了会自动放到画布上”。

## 测试与构建

```bash
export PATH=$HOME/.local/bin:$PATH
cd apps/web
npx tsc -p tsconfig.json --noEmit
npx vitest run                     # 32 个文件，225 个用例（2026-10-10）
cd ../.. && pnpm --filter @loomic/web build   # 静态导出到 apps/web/out
```

`test/setup.ts` 为 jsdom 补了 `matchMedia`。日志统一用 `[模块]` 前缀，例如 `[image-gen]`、`[studio]`、`[landing]`、`[ambient]`、`[auth]`、`[brand-kit]`、`[skills]`、`[canvas]`、`[node-canvas]`、`[chat-provider]`、`[settings]`、`[account]`、`[fonts]`，线上排查时可以按前缀过滤控制台。

## 已移除的上游内容

- **视频生成、积分、套餐、Lemon Squeezy 支付、本地注册、定价页**：主站计费模型下不存在这些功能。
- **首页灵感库**（`home-example-*`、`home-discovery-*`）：内容镜像自第三方站点（Lovart），包括英文和视频提示词、伪造的互动数，图片外链到上游 Supabase 项目 `jmcrxgenontlkxktpihl`，版权和可用性都不可控。前端已删除；**对应的 Supabase 表和迁移仍在**，需要的话由后端决定是否清理。
- **Loomic 品牌**：界面里已经没有 Loomic 字样。`@loomic/*` 包名和后端的 `LOOMIC_*` 环境变量没有改，避免影响构建和部署。

## 后端缺口与待确认事项

| 事项 | 现状 | 建议 |
| --- | --- | --- |
| 默认对话模型 | **已解决**：运行时读账户偏好（`model-resolver.ts`） | 10-09 agent01 删掉了前端双写和 `workspaceModel`，模型 id 解析改用 shared 的 `parseChatModelRef` |
| 自定义对话模型服务商 | **已解决**：后端接口、表、加密、SSRF 防护、运行时已实现（agent03）；`provider_*` 错误码进了 shared，`run.failed` 能带出来；`lib/chat-models.ts` 复用 shared 的 `parseChatModelRef` | — |
| Key 额度单位 | **已核实**：主站源码（`9717116f1`）里 `quota` 和 `quotaUsed` 是美元，`quota <= 0` 表示不限，界面一致 | 主站实际部署的版本还没核对，正式联调时看一眼 |
| 示例图版权 | `public/images/showcase/` 中 3/8/9/12 已换成 Unsplash License 图片（出处见 `components/landing/showcase.ts`）；其余 8 张继承自上游，来源未核实 | 上线前把其余 8 张换成本站生成或有授权的图 |
| Google Fonts | 前端已改为先走后端代理 `GET {API}/api/fonts/css2?family=&text=`（`lib/font-api.ts` 的 `loadFontStylesheet`），代理样式表加载失败时回退直连 `fonts.googleapis.com`；代理在本页成功过一次之后，单个字体失败只回退这一个。字体库预览只取字体名用到的字形（`text=`），品牌字体卡片加载完整字体；同一字体加载过完整版后不再追加子集（子集的 @font-face 没有 unicode-range，会盖住完整版）。后端代理已实现（`apps/server/src/http/fonts.ts`、`features/fonts/font-proxy.ts`，带 CORS 头，和其他接口一样受来源白名单约束） | **已解决**；直连回退保留，代理不可用时仍能显示 |
| P1 功能 | 单张价格预估、一键创建 Key、主站嵌入登录都还没做 | 后端接口就绪前，界面上不出现这些入口 |
| 起手式 | `lib/starter-prompts.ts` 里是写死的六个中文起手式 | 以后改成运营可配置 |

## 本地预览（不依赖后端）

视觉验收时，可以把站点构建到一个假的 API 地址，再在 localStorage 里注入一个未过期的 Supabase 会话（键名是 `sb-<host 第一段>-auth-token`），这样不连后端也能看到登录后的页面。本次验收用的就是这种方式，截图在 `apps/web/.impeccable/review/`。假数据服务没有提交进仓库，以免被误当成真实接口。
