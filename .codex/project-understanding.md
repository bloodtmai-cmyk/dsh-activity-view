# dsh-activity-view 项目理解

> 只记录稳定、可复用的事实与约定。行号对应本机已安装构建产物（`/Applications/DSH NEXT.app/Contents/Resources/app.asar` 抽出的 `ui-workspace` / `ui-sidebar` / `ui-slots`），升级 DSH 后需复核。
>
> 结论分层：① 源码 / 契约 / 单测层的结论可直接引用；② 转圈正圆与置顶行浮顶这两项已获真实 GUI 目视确认（验收记录在 ProjectMem 的 #0013 / #0014），该结论**只覆盖这两项**，不得由单测或这两项推断其它 GUI 场景；③ 其余 GUI 场景（精确定量首开耗时、全部主题与 rail 组合、滚动位置等）仍未取证，一律标「待验证」，不得写成「已全部通过」。

## 1. 这是什么

DSH 的客户端插件，在侧栏导航区加一个「活动视图」开关，打开后用一份**按活跃度排列的会话列表**替换原生会话列表（原生工具栏、footer、面板选择器一律保留）：带工作区名、原生置顶（pin）会话额外排在最前且不加分组标题、运行中会话在「非置顶部分」内部优先并显示转圈、其余按官方活动时间排序并分组（今天 / 昨天 / 更早）。

产物形态是纯客户端 bundle：

- `client.js`：唯一实质代码。通过 `window.__ModuleLoader__.load({ id: 'dsh-activity-view', factory(require) { ... } })` 注册（id 必须等于包名，见 §1.1），factory 返回导出对象（含 `apply`、`inject`，以及仅测试使用的 `__activitySlot`、`__activityMode`）。
- `index.js`、`package.json`、`cordis.patch.yml`、`locale/`、`icon.svg`：插件清单、补丁与文案。
- 无构建步骤（不需要打包/编译）：`client.js` 本身就是可被 `node --check` 解析的 ESM bundle。⛔ **落盘 ≠ 已加载**：asset 由宿主在装配 profile 时读入并注入页面，文件写进目标目录不代表当前页面已经用上新 asset。本机**没有经核实的 asset watcher / HMR 机制**（未核实），所以既不承诺「刷新即生效」，也不把「刷新永远无效」当定论；判断是否真的换了新 bundle 只能看实际装配结果（新 asset 是否被加载、Host Config 里是否出现新 row、Client Slots 里是否出现新 slot）。在没有 watcher 证据时按「重启/重建宿主 → 新页面加载新 asset」推进；重启动作本身按当次授权执行，不自行假定可以重启。
- **运行时读取的是同级 linked 安装副本 `../activity-view/`**（profile 里以 `link:` 依赖挂载，包名 `@local/activity-view`），本仓库是发布源且包名是 `dsh-activity-view`。⛔ 不要手工同步：需要部署候选时用 `node tools/make-linked-candidate.mjs`，它把候选复制到仓库内 `.stage-candidate/` 并只改发布标识。

## 1.1 发布标识与兼容路线（2026-11 更新）

三处标识必须同时一致，缺一处就会出现「asset 归属对不上、按钮/列表不出现」：

| 位置 | 发布形态（本仓库） | linked 部署候选（`.stage-candidate/`） |
| --- | --- | --- |
| `package.json` `name` | `dsh-activity-view` | `@local/activity-view` |
| `client.js` factory `id` | `dsh-activity-view` | `@local/activity-view` |
| `cordis.patch.yml` row `name` | `dsh-activity-view` | `@local/activity-view` |

- 候选只在这三处转换，其他内容逐字节相同（`candidate.json` 记录 source/candidate sha256 与 `changedFiles`）；源码仓库永远是发布形态，不改 profile、不改 linked 包名。
- `engines.dsh` 必须写**运行时版本**（`@deepseek-ai/dsh-app-boot` 的版本，当前 `0.2.2-rc.1`），不是 Desktop 壳版本 `2.0.22-next`。版本不符时 app-boot 会**整包跳过**（`evaluatePluginCompatibility` → bundle 进 `skippedBundles`，不贡献任何 patch 层），也就是本插件的两行 disable 不生效、原生 UI 原样保留——这正是想要的降级，不需要自己写版本判断。
- ⛔ 但**给 compat 包加 `engines.dsh` 并不等于「不会出现空白」**：该 guard 只管版本匹配，管不了文件 IO 与 import 失败。若两个 compat 包写着与 root 相同的 `engines.dsh`、却因为产物缺失、路径写错、`exports` 不对或依赖解析失败而导入不了，仍然会走到「原生两行已 disable、替代 asset 起不来」的空白，中间没有任何额外的兜底。真实空白风险集中在以下几处，必须靠**装配后实测**排除，不能靠版本字段：
  - compat 包目录/入口文件是否存在（相对 row name 指向文件，且该文件确实存在）；
  - compat 包自带 `package.json`（否则 manifest 落到 root，`dsh.client` / `engines` 判定全错）；
  - 宿主能否按 `exports['./client']` 取到唯一 client asset，loader 是否真的执行了它。
- 已验证到哪一步（分层，勿混说）：① 本仓库侧的静态验证成立 —— metadata 测试断言三处标识一致、row 指向文件、补丁只改 disabled、`compat/lib/build.mjs --check` 校验产物与 vendor 一致；② **真实宿主装配已经发生**：真实 compose 装配 + 重启宿主后装配成功，原生两行 disable 与两个 compat 包 / `activity-view` 互斥切换成立（不是「只剩 GUI」也不是「装配未证」）；③ **GUI 目视也只覆盖已取证的那两点** —— 当前 pin 置顶与正圆 spinner（证据由 main 侧取、记入 ProjectMem #0013/#0014）。⚠️ 本实现会话自身没有跑过 Loader、也没有做过 GUI 目视；因此不能把 ②③ 外推成「整体 GUI 通过」：首屏时序、主题 × rail 组合、滚动稳定性仍是待验证项。
- 兼容路线：原生 `ui-workspace`（row id `ui-workspace`）与 `ui-sidebar`（row id `ui-sidebar`）**按 id 精确关闭**，改用两个独立 compat 包 `@local/activity-ui-workspace` / `@local/activity-ui-sidebar`（各一个 asset/factory），再插 `activity-view` 自己。root `cordis.patch.yml` 里的 ready 形态是：
  - `- id: ui-sidebar` / `disabled: true`、`- id: ui-workspace` / `disabled: true`（只改 disabled，不替换 config，删掉本 bundle 即自然回到原生两行）；
  - insert 行名给到**入口文件**相对路径：`./compat/ui-workspace/lib/index.js`、`./compat/ui-sidebar/lib/index.js`（`anchorInsertedPluginNames` 会把相对名转成 file URL；Node ESM 对**目录** URL 报 `ERR_UNSUPPORTED_DIR_IMPORT`，所以不能写目录；写文件时 `manifestOf` 会按该文件向上找到 compat 包自己的 `package.json`）。
  - 因此每个 compat 包目录**必须自带 `package.json`**（含 `exports['./client']` 与 `dsh.client`），否则 manifest 会落到 root 上，engines/compat 判定失真。

## 2. 数据来源（唯一可信合同）

会话行来自 `ctx.sessions.list.getSnapshot()`，结构 `{ ids, byId, projectionsBySession, items }`（快照初值见 `dsh-api-session-controller/lib/client.js` L3832-3837）。`byId` 的每行由 `projectList()` 产出（同文件 L4168-4185）：

`id`、`displayTitle`、`running`、`retainedBy`、`blank`、`updatedAt`、`formatStatus`，以及可选的 `projectionValues`、`title`、`cwd`、`parentId`、`origin`。

时间字段的来路：

- `updatedAt` 由 `handleSessionActivity` 通过 `ctx.remote.$on('api-session/activity', ...)`（L4291-4292）更新，取 `Math.max(summary.updatedAt, metadata?.lastPromptAt ?? 0)`（L3610）。
- 因此 `updatedAt` 已经是官方口径的「最近活动时间」，插件**不需要**也不应该再去读 `lastPromptAt` 之类的投影字段自行取 max。

子会话标识：原生 `isChildRow` 判 `origin === 'subagent'` **或** `parentId !== ''`（同文件 L4183-4184）。

可见性口径（以生产流为准）：`collect` 走的是 `sessionVisible(row, current, archived, archivedFilter)`，**只排除 `origin === 'subagent'`**，并额外处理 blank 例外与归档三态；它**不调用** `isChildRow`，所以带 `parentId` 但 `origin !== 'subagent'` 的行（例如 fork 等非 subagent 派生行）照常出现在活动列表里，不额外隐藏。`isChildRow` 仅作为诊断/测试辅助导出，不参与 collect 过滤。

## 3. 展示规则（`client.js` 内纯函数命名空间 `D`，全部有回归测试）

1. 时间只取官方 `updatedAt`；缺失/非法（非正数、非可解析字符串）时为 `undefined`，**不伪造当前时间**，归入「更早」。
2. `running` 会话：在**非置顶部分内部**排在最前（全局最前是原生 pin 段，见第 8 条）；行内**只显示工作区**（当前没有已定义的「运行中」文案 key，不新造），**`entry.time` 保留 `updatedAt` 原值、且不做相对时间格式化**——否则 5 天前的会话一旦 running 就会在「今天」组里写成「5 天前」；分组仍按展示规则归入「今天」，不为分组改写数据。
3. 去重只按官方 `row.id`，绝不按标题合并：不同会话同名是常态。
4. 顺序：先排序再限量（`MAX_ROWS = 25`），否则新活跃会话会被截掉；置顶行是**额外**的一批，不占这 25 条配额（见第 8 条）。
5. 分组用日历日边界（今天 00:00、昨天 00:00、再往前）；「昨天」用 `setDate(getDate()-1)` 推进，不用固定 86400000 差值（DST 日 23/25 小时）。相对时间/跨零点由本地分钟时钟驱动重算，不轮询 session API。
6. 相对时间只返回 i18n key（`now` / `minutesAgo` / `hoursAgo` / `daysAgo` + `{count}`）+ 分组 key（`today` / `yesterday` / `earlier`），由 `MESSAGES` / 宿主 locale 翻译，不在逻辑层拼中文。
7. `archived` 会话：仅当宿主 `view.archivedFilter` 允许时出现，打开走原生 `actions.openSession`（`guardedOpen`，归档会话有原生提示），加 `avRowArchived` class + `aria-disabled`，并由**真实 CSS 规则**（`.avRowArchived .avTitle/.avMeta { color: var(--dsw-alias-label-caption) }`）灰显；不新增 badge、不新增写 API。
8. 原生置顶（pin）：来源是 owner 合同字段 `props.sessions.pinnedSessionIds`（不是快照行上的 `session.pinned`）。未归档的置顶行整体排在最前，**不画分组标题**——顶部直接就是置顶行，随后仍是今天 / 昨天 / 更早，不加新标题、不留空标题高度、不新增 i18n key（内部组 key 用 `pinned`，但 `header:false`）。置顶段的排列顺序：先按 `props.sessions.flatSessionIds` 的相对顺序挑出其中被 pin 的 id，`flatSessionIds` 里没有的 pin 再按 `pinnedSessionIds` 数组顺序追加——`pinnedSessionIds` 的数组顺序**不是**原生完整顺序（原生 `reconcileManualOrder` 的 savedOrder 优先、缺失 pin 追加），不要拿它当唯一顺序来源。全程精确 `id` 匹配、按 id 去重、不按标题前缀合并；归档的 pin **不进**置顶段（与原生 `sectionMembers` 一致），在 `archivedFilter: 'show'` 下回既有日期组灰显，不新增「归档段」。宿主没有 `pinnedSessionIds` 时行为等同于「没有置顶功能」；置顶行不占 `MAX_ROWS`，也不改变 `entry.time` 原值与 running 图标。

## 4. 插槽合同（已与宿主补丁对齐，改动需同步补丁与本节）

### 4.1 两个 key，缺一不挂

| 用途 | key | kind / scope | 注册要求 |
| --- | --- | --- | --- |
| 列表 occupant | `sidebar.workspaces.sessions`（`SLOT_KEY`） | `single` / `root` | 只在活动模式开启时占位；不占位时原生列表由 `renderSlot` 的 fallback 渲染 |
| 导航动作行入口 | `sidebar.navigation.action`（`ENTRY_KEY`） | **`list`** / `root` | 必须 `options.id='activity-view'`、`options.order=20`，`locale=NS` |

- 宿主把入口渲染在 `nav.panelList` 里、原 PanelRows 之后、More 之前；**外面没有原生 button**，所以入口自己就是 `<button type="button">`，不自带 `selectPanel`。
- 入口只在 `decideSlot(SLOT_KEY).mounted === true` 且 `decideEntry(spec).mounted === true` 时注册；任一槽未声明（或 `ENTRY_KEY` 的 kind 不是 `list`）→ 既不注册按钮也不注册列表 occupant，只打一条 warning，不留死按钮。
- `decideSlot` 要求 `kind === 'single'`；`decideEntry` 要求 `kind === 'list'`。两个 `inject` 回调都调用幂等的 `resync()`（`syncListOccupant()` + `syncEntry()`），因此两个槽任意先后到达都能补齐，槽位消失再出现也能恢复。
- 注册与清理走真实的 `ctx.slots.inject(key, () => {...; return () => teardown()})`：回调是**同步函数返回 Dispose**，不是 `function*`（`SlotCore` 没有 `inject` 方法，`inject` 属于 Cordis 包装层）。`ctx.effect` 负责回收订阅 + 两个注入 Dispose + 字典注册。

### 4.2 入口 button 的 class / 属性合同（类名来自 props，插件不自绘）

props：`{ wide: boolean, classes: { panelRow, panelActive, panelGlyph, panelTitle, wide } }`（宿主传原生 CSS 类名）。

```
<button type="button"
        class="{classes.panelRow}[ {classes.panelActive}]"   // 活动模式开启才加 panelActive
        aria-pressed="{true|false}"
        aria-label="{t('iconLabel')}"
        title="{t('iconLabel')}"
        onClick={toggle}>
  <span class="{classes.panelGlyph}" aria-hidden="true">{pulse svg, 宽 16 / 窄 18}</span>
  {wide ? <span class="{classes.panelTitle} {classes.wide}">{t('panelTitle')}</span> : null}
</button>
```

- `wide === false`：只渲染 glyph（`panelTitle` 不出现），字形尺寸 18；宽态 16。照原生 PanelRow：标题 span 挂 `clsx(panelTitle, wide)`（两个类都在 **span** 上，不挂到 button），字形尺寸对齐原生 `renderSlot('sidebar.panellist', { size: wide ? 16 : 18 })` 的形态。
- 只绑定 `toggle`：不调 `selectPanel`、不碰 footer / panellist、不注册未声明的 global panel、不画背景（背景与配色全部由宿主类名与 CSS 变量透上来）。
- `wide === false` 的列表 occupant：不注册（原生列表继续走 fallback）。

### 4.3 语言（locale）合同

- 字典：`MESSAGES = { en: {...}, zh: {...} }`，中英 key 必须一一对应。key 集：`panelTitle`、`iconLabel`、`loading`、`empty`、`failed`、`unavailable`、`now`、`minutesAgo`、`hoursAgo`、`daysAgo`、`today`、`yesterday`、`earlier`。
- 注册：按原生范式 `ctx.effect(() => localeService.register(NS, MESSAGES), 'activity-view: dictionaries')`（等价 `ui-workspace` L5785-5793 的写法），`NS = 'activityView'`，两个 `register` 都带 `locale: NS`。
- 取词：组件优先用宿主传进 props 的 **`props.t`**（`SlotOutlet` 按 `entry.locale` 绑定好的座位）；没有 `props.t` 时用注入的 `translate`（内部 `localeService.bind(NS)`，每次调用现取，切语言无需重建闭包）；两者都没有时落到自带英文表。
- **禁止**探测未证实的字段（`localeService.language()` / `getLocale` 之类）来猜语言——zh 宿主会因此退化成英文。

### 4.4 已否决、不得复活的路线

1. 在原生列表上方铺透明覆盖层并按实测行高/标题度量下发 CSS 变量（两棵树同时绘制、文字重叠）。
2. 任何 `document.querySelectorAll`、`MutationObserver`、capture 阶段全局监听、`document.documentElement` 属性下发、祖先节点 paint 抄背景。
3. 接管 `sidebar.workspaces`（`WorkspaceBrowser` 是 ui-workspace 模块私有，接管等于替换整个会话浏览）。
4. 全局 `ensureStyle` + `document.head` 注入固定 id 样式表；样式改为组件内 `<style>` 子节点，无全局 id，热更新不留陈旧 CSS。

### 4.5 模式（mode）行为

- 开关状态存在插件内部 store（`__activityMode`：`isOpen/setOpen/toggle/checkGrouping/subscribe/getSnapshot`），不写宿主状态、不进 URL。
- 原生 `groupBy` / `orderBy` 变化 → 自动退出活动模式并注销 occupant（不回写、不撤销用户的选择）；`archivedFilter` 变化**不**退出。
- **模式基线（baseline）属于 activation 生命周期，存在 store 里**（`snapshot.baseline`），不是组件 `useRef`：搜索 / rail 收起会让 occupant 临时 unmount，`useRef` 会跟着丢，重挂时就会把用户改过的原生分组当成新基线而不退出。规则：`setOpen/toggle` 清基线（含 on→off、off→on），`open` 后第一次 `checkGrouping(modes)` 只记基线，之后 `shouldLeaveActivityMode` 为真即静默退出。
- 搜索：走原生分支（活动模式下搜索栏仍按原生逻辑过滤，不由本插件接管）。
- 行布局/样式采用宿主已证实的 layout token，不 DOM 测量、不猜 token：行 `height:32px; padding:0 8px; padding-inline-start:calc(var(--dsh-sidebar-row-padding) - var(--dsh-sidebar-paint-inset) + var(--dsh-workspace-indent,0px)); border-inline-width:var(--dsh-sidebar-paint-inset); border-radius:var(--dsw-radius-md); background-clip:padding-box`，标题 `margin:0 6px 0 var(--dsh-sidebar-label-gap)`，leading `16×20`，meta `12/20` + time `10/16`。**滚动归 occupant 自己**：补丁替换的是 `listArea` 里那个 `<FlatList>`/`<SessionTree>` **元素本身**，而原生 `.NSkPbW_list` / `.NSkPbW_treeBody` 只存在于**未占位时的 fallback 组件内部**——override 生效时它们根本不存在。所以根节点 `.avRoot` 必须自己当唯一滚动容器，按原生 `.list` 的 token 复刻：`flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; scrollbar-gutter:stable; margin-left:-4px; margin-right:var(--dsh-session-list-scrollbar-offset); padding-left:4px; padding-right:calc(var(--dsh-session-list-edge-inset) - var(--dsh-session-list-scrollbar-width) - var(--dsh-session-list-scrollbar-offset)); padding-bottom:16px`，且 `background-color:transparent`（不画背景，sidebar 背景透上来）；内容组 `.avGroup` 与行 `.avRow` 用 `flex:none` 防止在列向 flex 里被压扁。不要指望任何 fallback 父容器提供滚动。
- 行内交互：`closest` 找到的交互元素必须**严格位于 `event.currentTarget` 之内**才 `stopPropagation`。原生 sessionRow 自己就是 `role=button`，普通 leading span/`avSpin` 向上 `closest` 会命中**外层行本身**（非 null），因此判定要排除 `found === boundary`，并要求 `boundary.contains(found)`；无法判定包含关系（无 `contains`、target 为空、target === boundary）一律按「不抑制」处理。只有边界内的 `button/a/input/textarea/select/summary/[role=button]/[role=link]/[data-context-menu-trigger]` 才抑制；点 leading 空白、工作区名、时间都照常打开会话。`onKeyDown` 只在 `event.target === event.currentTarget` 时响应 Enter/Space，避免子按钮回车被父行再开一次。
- 右键菜单：行 `onContextMenu` → `props.actions.openSessionMenu(id, title, {x: event.clientX, y: event.clientY}, 'open')`，`preventDefault + stopPropagation`。原生签名是 `openSessionMenu(sessionId, displayTitle, point, mode)`，只有 `mode === 'toggle'` 才会关掉同一会话的菜单；右键不是开关动作，必须用非 `toggle`（当前用 `'open'`）。原生行本身没有 `onContextMenu`、也没有键盘菜单，所以没有原生行为需要保留。
- leading 座位：`row.leading(id)` 返回的是 **SlotOutlet React 元素，即使为空也不是 `null`**，所以不能用「非 null」判断有没有内容。running 行一律用自带 `avSpin`（不吞原生 spinner、也不造未读点 `.avDot`）；非 running 行用原生 leading 元素，原生为空就是空占位。
- 转圈图标是**固定几何的 SVG 正圆**，不用 border 环（border 环放在方形容器里视觉上不圆，用户已否掉）：方形容器 + `viewBox="0 0 16 16"`、图形 12×12、底环 `circle cx=8 cy=8 r=6.5`（`opacity:.3`）、弧 `M8 1.5A6.5 6.5 0 1 1 1.5 8`、`stroke-width:1.5`、圆头端点，旋转加在外层 span 上并固定 `transform-origin:50% 50%`。**原 leading 的 16×20 占位与行高/对齐保持不变**，换图标不改变行布局。

## 5. 验证边界

- 纯逻辑 + registry 回归：`node --test --test-isolation=none --test-reporter=spec test/activity-data.test.cjs`（当前 38 例：37 通过 + 1 例 DST skip；历史命令与退出码见 `logs/02-suite.log`；`TZ=America/New_York` 另跑一次见 `logs/03-suite-tz.log`，那次的通过数只对应当时代码）。
  - 数据层：官方 `updatedAt`、缺失/非法为 `undefined`、按 `id` 去重、同名不合并、排除子会话、运行中在非置顶部分优先、运行中滞留仍归「今天」、先排序再限量、日历日分组、`formatKey`、工作区/标题回退、`archived` 过滤、置顶段顺序（`flatSessionIds` 相对顺序优先、缺项按 `pinnedSessionIds` 追加、按 id 去重）、置顶行不占 25 条配额、旧置顶行保留真实时间且与 running 并存、归档置顶行不进置顶段（`archivedFilter: 'show'` 下回日期组）、宿主无 `pinnedSessionIds` 时等价无置顶。
  - 组件（SSR 式结构断言，用 React 桩渲染元素树，不建 DOM）：`wide=false` 空壳、单行结构、running 行 meta 只有工作区且不渲染时间、非 running 行照常相对时间、`avSpin` 优先于原生 leading（并断言它是固定几何的 SVG 正圆而不是 border 环）、置顶段结构（置顶行排在最前、`avGroupTitle` 只有今天/更早这些既有标题、置顶段自己不出标题）、右键菜单参数形状与 `mode !== 'toggle'`、非交互区域点击不被吞（含「`closest` 命中外层行」反证，旧写法在此会误吞）+ 边界内原生控件外溢被抑制 + 无法判定包含关系时不抑制 + 子节点 Enter 不替行开会话、归档灰显 CSS 规则存在、行样式含已证实 token 且根节点确为唯一滚动根（`overflow-y:auto`/`flex:1`/`min-height:0`/`scrollbar-gutter:stable`/`padding-bottom:16px`/透明背景）、内容组与行 `flex:none`、groupBy/orderBy 退出、**临时 unmount 期间改原生排序后重挂仍退出**（基线在 store）、empty/loading/unavailable。
  - 生命周期（**真实 `SlotCore`**，来自 `.stage-hostpatch/stage/ui-slots/lib/index.js`，即标准 `test/helpers/prepare-host-fixtures.mjs` 产物）：`inject` 回调同步返回 Dispose、开关驱动 occupant 注册/注销、槽位未声明不注册、single 槽被占时不抢位、双槽到达顺序、槽位消失/重现、模式 on/off、入口按钮属性与类名、teardown 无残留。
  - locale：`register(NS, {zh,en})` 契约、中英 key 完备、`bind(NS)` 兜底、`props.t` 优先、`ctx.effect` 回收字典注册。
  - DST：`TZ=America/New_York` 下断言春秋切换周的「昨天」为 23/25 小时且不等于 −86400000；其他时区 `SKIP`（不是失败）。
- fake-DOM / 自造 document 的断言**不能**当作界面证据：无法覆盖合成背景、滚动裁剪、与原生列表的可见性互斥、真实点击。
- 运行器坑：本机 `node --test` 默认的逐文件子进程隔离会偶发在输出完成后 SIGTRAP/SIGSEGV（退出码 133/139，用例全绿）；加 `--test-isolation=none` 稳定。
- 上述组件用例使用**真实 `SlotCore` + 注入替身 + React 桩**，不是完整 Cordis 运行时、不是 SSR、也不渲染真实 DOM：它们只证明「交给宿主的元素/props 形状与逻辑分支」，**不能当作界面通过证据**。
- 发布元数据/组合契约另有一组断言：`test/bundle-metadata.test.mjs`（三处标识一致、`engines.dsh` 是运行时版本、按真实 row id 关原生两行且只改 disabled、相对 row name 必须是文件、候选助手只改三处标识）。
- **GUI 取证现状（必须分层表述，不得合并成一句「已验证/未验证」）**：
  - 已有真实 GUI 证据的两项（用户手动刷新并置顶 + 主代理只读桌面取 AX/截图，验收记录在 ProjectMem 的 #0013 / #0014）：顶部出现**无分组标题的置顶段**且同一屏只出现一次，其下紧接 `Today` 普通首行；AX 层置顶行首出现「取消置顶」而普通首行没有；三个 running 行首均呈正圆指示；原生 header（搜索/视图选项/添加工作区）与 footer 统计完整。**结论只覆盖这两项**。
  - 仍未取证、且**不得由单测或上面两项推断**：精确定量的首开耗时（只有粗观测，无 paint 数值）、全部主题 × rail 收起/展开的组合、滚动位置稳定性，以及其它未明确点到的 GUI 场景。
  - 表述纪律：写「该项已验证」或「该项未验」时要点名具体项，不得用一项的通过去替代整体 GUI 验收；`props.t` 是否由该 SlotOutlet 真实传入仍需单独确认。

## 6. 约定与风险

- 变更只在工作树进行；提交/推送、同步安装副本都需要单独确认。
- 任何「时间/标题」类字段先用构建产物里的生产代码确认存在，再写进逻辑；拿不准就在文档里标「待验证」，不要用猜测字段兜底。
- 报告要给真实命令与退出码；`node --check client.js` 只证明语法通过，不证明逻辑正确。
- 部署形态相关：`tools/make-linked-candidate.mjs`只写仓库内 `.stage-candidate/`（已 `.gitignore`），不改 profile、不改 `../activity-view/`；compat 包内容由宿主补丁流程生成，`compat/lib/build.mjs --check` 做可复现校验。

### 6.1 同步到 linked 安装副本的固定规则

- 顺序固定为：① 核对目标 realpath 必须是 `.../default-workspace/activity-view`、原包名仍是 `@local/activity-view`、原 `client.js` sha 与上一版记录一致（漂移即停）；② 用 `tools/make-linked-candidate.mjs` 生成候选并确认源码与候选只差三处发布标识；③ **先备份将被覆盖的文件**到仓库内唯一新目录 `.stage-candidate/backup-linked-<时间戳>/`（含 `backup-manifest.json` 记录每个文件 sha256）；④ 按「compat/patches 与普通文件 → `package.json`+`client.js` → 最后 `cordis.patch.yml`」的次序复制，**只覆盖候选清单列出的文件**；⑤ 逐文件比对复制后 sha 与候选一致。
- 任何时候都不删除目标目录里候选清单之外的既有条目（历史 tgz、`research/` 等），也不覆盖或删除旧的候选目录/旧的 backup 目录。
- 回滚：`node .stage-candidate/backup-linked-<时间戳>/restore.mjs` 按 manifest 原样写回被覆盖文件并复验 sha。⚠️ **没有删除分支**：`--remove-added` 已撤销（#0012），带参数调用只会退出 2；restore 只做「按 manifest 覆盖恢复」，不会删除该次新增的 `compat/`、`patches/` 等文件，要清理必须另做并逐项确认。
- 落盘 ≠ 已加载：文件复制到目标目录只说明「磁盘上是新的」，宿主是否已按新 asset 装配要另行确认。用只读 inspect（Host Config 里是否出现新 row、Client Slots 是否出现新 slot、加载到的 asset 内容是否为新版）判定是否已 recompose；没有这些证据就只能报「已落盘、未确认装配」，不能当上线或 GUI 通过。本机**没有经核实的 asset watcher**（未核实），故不承诺刷新即生效；需要重启/重建宿主时按当次授权执行。
- 测试复用宿主标准 fixture 准备流程（`test/helpers/prepare-host-fixtures.mjs` → `.stage-hostpatch/`），不要自己另写抽取器；`.stage-hostpatch/` 是临时产物，已在 `.gitignore` 忽略，不入库。

### 6.2 改写值的语法转义与真实解析校验（#0011）

- **任何写进候选的标识值都必须按目标语法转义，禁止模板直接拼接**：`tools/make-linked-candidate.mjs` 的 `REWRITES.to` 只允许调用 `yamlDoubleQuoted` / `jsSingleQuoted` / `jsonString`。YAML 里 `@` 是**保留指示符**，不能作为 plain scalar 起始字符，`name: @local/activity-view` 会让解析器直接报 `found character that cannot start any token`（ruby Psych 3.1.0 实测，行 24 列 13），profile 装配阶段就 SyntaxError；正确写法是 `name: "@local/activity-view"`。历史上「两种写法解析成同一个字符串」的判断是**错的**，不要再用。
- **候选指纹必须覆盖改写结果**，不能只 hash 源内容与 `localName`：否则改改写算法（例如补引号）后指纹不变，工具会命中旧目录返回「已存在、内容相同」，修好的产物永远生成不出来。当前指纹 = `name\0version\0localName` + `fingerprint-version\0 2` + 每个文件 `路径\0源 sha256` + 每条改写 `file\0from\0to`。
- **回归用真实解析器**：`test/yaml-patch-parse.test.mjs` 调系统 `/usr/bin/ruby` + Psych（不装依赖、不手写 parser）解析四份 patch —— 仓库发布 patch、候选改写产物、已生成候选目录里的 patch、实际 linked 目标 patch —— 并断言恰好 3 条 `insert` 的 `name` 与 2 条 `disabled`；历史未加引号的候选样本必须**解析失败**。本机 PyYAML 未安装，只用 Psych。
- 交付/更正记录：更正只追加新文件（如 `.stage-candidate/backup-linked-*/deploy-correction-0011.json`），**不改**首次部署的 `deploy-log.json` / `backup-manifest.json`；旧候选目录（含带缺陷的 `…-df9f9e2dd147-linked`）保留不删，用新候选取代。
