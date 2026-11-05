# 宿主补丁 0001 + 0002

本 README 覆盖两个**互相独立**的最小宿主补丁，属不同包，各打各的、无先后依赖：

- **0001** → `ui-workspace`：`sidebar.workspaces.sessions`（会话列表体扩展点）。本文第 1–10 节。
- **0002** → `ui-sidebar`：`sidebar.navigation.action`（原生 panel 导航区里的「导航动作行」扩展点）。见文末「补丁 0002」一节。

**状态**：仅在工作区准备好补丁，**未安装、未提交、未部署**。目标应用 `/Applications/DSH NEXT.app` 与本机 `~/.dsh` 未做任何改动。

---

# 补丁 0001：`sidebar.workspaces.sessions` 会话列表扩展点

## 1. 这是什么

给已经构建好的 DSH 组件 `@deepseek-ai/dsh-client-ui-workspace@0.2.2-rc.1` 的 `lib/client.js` 增加**一个**子槽 `sidebar.workspaces.sessions`，让插件可以只替换「侧栏会话列表的列表体」，其余原生结构（头部工具栏、搜索、视图选项、新增 workspace、对话框、行内按钮与右键菜单）全部保持原生实现。

- 形态：清单一处 shell 补丁，`patches/0001-sidebar-workspaces-sessions-slot.patch`，4 个 hunk，**净删 1 行、其余为新增**（+1201 字节）。
- 不是上游源码 PR：仓库里没有对应的 TS 源，本补丁针对**已构建产物**，以版本号锁定（见第 2 节）。上游升级后必须重新生成，不能直接复用。
- 无 occupant 时**原生分支源码原样保留**（整套原生列表被挪进 `opts.fallback`），不额外占布局盒；但 `renderSlot` 每次调用都会渲染 renderer 固定的 `<div data-slot=… style="display:contents">` 锚点，所以**不是「零 DOM」，也不宣称与未打补丁逐字节/像素等价**——渲染像素尚未 GUI 验证。

## 2. 版本锁定与适用性

| 项 | 值 |
| --- | --- |
| 包 | `@deepseek-ai/dsh-client-ui-workspace` |
| 版本 | `0.2.2-rc.1` |
| 目标文件 | `lib/client.js` |
| 原始大小 / sha256 前 16 位 | 285182 B / `89b32d7916cb56da` |
| 打补丁后大小 / sha256 前 16 位 | 286383 B / `fc8521e1394cb762` |
| 补丁文件 | `patches/0001-sidebar-workspaces-sessions-slot.patch`（`patch -p1`，路径 `lib/client.js`） |

应用前先核对原文件哈希；不一致（升级过）则**停止**，重新跑补丁生成流程，不要强打。

## 3. 安装 / 回滚（在包目录下执行，`-p1` 对应包根）

**必须用 `-N --batch`，并且先 dry-run**：

```bash
# 示例只用**工作区副本**：工作目录 = 包根（含 lib/client.js）。
# 本机真实包在 `/Applications/DSH NEXT.app/Contents/Resources/app.asar` 内（asar 归档，不是普通目录）。
# 解包 / 回包属宿主维护流程，必须**另次授权后单独执行**；本文不给该步骤，也不假设任何 unpacked 路径存在。
mkdir -p /tmp/dsh-patch-try && cp -R .stage-hostpatch/stage/ui-workspace /tmp/dsh-patch-try/
PKG=/tmp/dsh-patch-try/ui-workspace

cd "$PKG"
shasum -a 256 lib/client.js          # 必须是 89b32d7916cb56da…，否则停止（见第 2 节）
cp lib/client.js "lib/client.js.orig-0.2.2-rc.1"
patch -p1 -N --batch --dry-run < /path/to/patches/0001-sidebar-workspaces-sessions-slot.patch
# 仅当上一条 rc=0 才继续：
patch -p1 -N --batch < /path/to/patches/0001-sidebar-workspaces-sessions-slot.patch
```

**为什么必须 `-N --batch`**：不加这两个选项时，`patch` 遇到"已打过 / 已改过"会交互提问（`Assume -R? [y]`、`Ignore -R? [y]`），stdin 被重定向时它会自行猜答案并**返回 0**——看似成功，实际什么都没做、或做了反向操作。实测：不带 `-N` 对已打补丁的文件二次 apply，rc=0 但文件未变；带 `-N --batch` 则 rc=1 明确拒绝。

回滚：

```bash
cd "$PKG"
patch -R -p1 -N --batch < /path/to/patches/0001-sidebar-workspaces-sessions-slot.patch
# 或直接还原备份
mv "lib/client.js.orig-0.2.2-rc.1" lib/client.js
```

### 拒绝套用：实测行为表

| 目标文件状态 | `--dry-run` | 实际 apply | 文件是否被改 |
| --- | --- | --- | --- |
| 原始 `0.2.2-rc.1`（sha256 `89b32d79…`） | rc=0 | rc=0 | 是，产物 sha256 = `fc8521e1…` |
| 已打过本补丁 | rc=1 `Ignoring previously applied (or reversed) patch. 4 out of 4 hunks ignored` | rc=1，并写 `lib/client.js.rej` | **否**（哈希不变） |
| 已被他人局部改动（例：改了 `FlatList` 那一行） | rc=1 `1 out of 4 hunks failed` | rc=1，但**前 3 个 hunk 已被写入** | **是** ← 这就是必须先 dry-run 的原因 |
| 反向还原后 | — | rc=0 | 与原始文件**逐字节相同**（`cmp` rc=0） |

结论：**dry-run rc≠0 一律停止**，并清理残留的 `lib/client.js.rej`、`*.orig`；不要用 `-l`、`--fuzz` 或模糊匹配把冲突"打通"。

## 4. slot 合同（插件实现方以此为准）

- key：`sidebar.workspaces.sessions`
- `kind: "single"`，`scope: "root"`，由 `sidebar.workspaces` 这条 entry 的 `children` 表声明。
- 注册：`ctx.slots.register({ name: "sidebar.workspaces.sessions" }, Component)`（priority 默认 0）。
- 同 priority 第二人注册会**抛错**（不是静默覆盖）：`single slot "…" already has a registration at priority 0 — register at a different priority to shadow it (lowest renders)`。要压别人用更小 priority。
- **反应式由渲染层保证**：`SlotOutlet` 内部 `useSyncExternalStore(fn => host.subscribe(slotKey, fn), () => host.getVersion(slotKey))`，注册/释放 occupant 都会 bump version 并让 outlet 重渲染，自动在 occupant 与 `opts.fallback` 间切换。宿主侧**不做** apply 期一次性 entry 计数，也不允许用「`renderSlot(...)` 返回非 null」判断占位是否存在（那返回的是 React element，永远非 null）。

## 5. owner（entry 的 props）合同

宿主把下列对象作为第二个参数传给 `renderSlot`，其字段以 spread 传给 entry 组件（同名覆盖 standard props）：

```js
{
  view: { groupBy, orderBy, archivedFilter, wide, ready },
  sessions: {
    list,                     // useSessions 快照（phase/ids/byId…），与原生同源
    workspaces,               // 已排序 [{ workspaceId, title, sessionIds }]
    ungroupedSessionIds,      // 不属于任何 workspace 的会话（已排序）
    flatSessionIds,           // flat 视图的完整有序 id
    currentSessionId,         // 原生 currentBlank
    archivedSessionIds, pinnedSessionIds, home
  },
  actions: { openSession, openSessionMenu, startSession, setArchivedFilter, setGroupBy },
  row: { actions, leading, trailing, hover }   // 均为 (sessionId) => renderSlot(原生槽位, { sessionId })
}
```

补充说明：

- `renderSlot` 第二个参数里同时带 `hookContext`（同一份 owner），只有 entry 声明了 contextual `inject`（函数式 hooks 源，`factory(standard, hookContext)`）时才需要；`{ hooks: {...} }` 形式的普通 inject 不需要。
- renderer 自动注入的 standard props 照常可用：`useSessions`、`useWorkspaces`、`usePanelInfo`、`useSessionStatus`、`useSessionAccess`、`useRemoteAccess`、`useWorkspaceAccess`、本 entry 的 `useStore`/`actions`，以及声明了 `children`/`locale` 时的 `renderSlot`/`t`。
- owner 每次渲染是新对象，**不要**用对象身份做 memo key。
- 未提供 `requestSessionRename`（签名未在运行时取证，避免猜测）；重命名走 `actions.openSessionMenu` 的原生菜单项。

## 6. owner 生效时各控件的行为

| 控件 / 状态 | 行为 |
| --- | --- |
| 头部标题、搜索按钮与输入框 | 原生，未改动 |
| 搜索态（`normalizedQuery !== ""`） | 走原生 `SearchResults`，**不经过本槽**；插件不会被渲染 |
| 视图选项（groupBy / orderBy） | 原生控件仍可点，但**插件不跟随**：见 6.1 的配套约定——用户在原生菜单改这两项时插件撤回占位，由原生列表按新选择生效 |
| 归档筛选（archivedFilter） | 留在活动模式内，由插件按原生真实过滤规则处理（见 6.2） |
| 新增 workspace（directoryFlow） | 原生，未改动 |
| 对话框（rename/fork/archive 等） | 原生，未改动 |
| 行内 leading / trailing / hover / action 控件 | 通过 `owner.row.*` 渲染原生 entry（含权限判断，无权限返回 null）；插件不必重造 |
| 行右键 / 更多菜单 | `actions.openSessionMenu(sessionId, title, point, mode)`，原生项（重命名/置顶/归档/分叉/复制 id）全部可用；`mode==="toggle"` 时同目标再点会关闭 |
| 打开会话 | `actions.openSession` 即原生 `guardedOpen`：已归档会话先给原生提示，不会静默打开 |
| 侧栏 rail / 窄态（`wide === false`） | 外层 `wide && (...)` 保持原样 → 该区域什么都不渲染，插件也不会被挂载 |
| 插件 inactive / 未安装 / 声明缺失 | 不注册 → 立即回落原生 fallback，与未打补丁一致 |

### 6.1 活动模式与原生视图菜单的配套约定（由插件落实，宿主只提供数据与 fallback）

- **活动模式固定排序**：插件激活时按 running / date 展示（running 会话归入"今天"，不伪造 `updatedAt`），**不复刻** workspace / manual 分组排序。
- **用户在原生视图菜单改动 groupBy 或 orderBy 时，插件自动 dispose**（撤回 registration）：outlet 立即回落原生列表，并按用户的新选择渲染；插件**不撤销、不回写**用户的原生选择。
- 依据：`view.groupBy` / `view.orderBy` 通过 owner 传入，但**"传了值"不等于"插件会遵守"**——最终行为以上述 dispose 约定为准，宿主不保证插件跟随这两个值。
- 因此原生视图选项在活动模式下仍**可用**（它会生效，只是生效方式是切回原生列表），不是装饰性控件。

### 6.2 归档与 `flatSessionIds`

- `archivedFilter` 留在活动模式内：插件自己按原生规则过滤。
- 注意：`owner.sessions.flatSessionIds` 是原生**未按 archive 过滤**的有序 id 列表（`list` 快照的原始顺序），插件必须自行按 `archivedFilter` / `archivedSessionIds` 过滤，不能直接当"当前可见列表"用。

### 6.3 GUI 未验证

以上行为约定来自补丁 + renderer 源码推断，**没有在真实 GUI 里验证过**：本次未安装补丁、未重启应用、未观察像素。凡涉及"用户点下去会怎样"的结论，只到"代码路径成立"为止，不等于已验收。

## 7. 布局与样式约束（避免重蹈上一版白底叠字）

- 挂载点在 `WorkspaceBrowser` 的 `.listArea` 内（flex 列，`flex:1; min-height:0`），**滚动容器由 occupant 自己负责**：原生 `.list` 的 5px 滚动条、edge inset、fade mask 只在 fallback 路径生效。
- outlet 是 `<div data-slot="…">` 且 `display: contents`：**不要自绘背景**，透明即继承 sidebar 底色（上一版给 `documentElement` 追加固定浮层并采样祖先背景/渐变，才出现白底与文字叠加、两份列表同时可见）。
- 可继承变量：`--dsh-session-list-edge-inset`、`--dsh-session-list-scrollbar-width:5px`、`--dsh-session-list-scrollbar-offset:2px`、`--dsh-sidebar-inline-padding`、`--dsh-sidebar-row-padding`、`--dsh-workspace-indent`。

## 8. 已执行的验证（全部在工作区暂存副本上）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 补丁可生成且锚点唯一 | `node test/helpers/prepare-host-fixtures.mjs`（可复现路径；当时用的是本地临时生成器 `make-patched.mjs`） | rc=0；4 个替换锚点各命中 1 次，产物 sha256 = `fc8521e1…` |
| 语法 | `node --check`（复制为 `.mjs`，产物是 ESM） | rc=0 |
| 干净产物 dry-run | `patch -p1 -N --batch --dry-run` | rc=0 |
| 干净产物 apply | `patch -p1 -N --batch` | rc=0，sha256 = `fc8521e1394cb762…` |
| **已打过补丁再 apply** | 同上 | **rc=1**，`4 out of 4 hunks ignored`，文件哈希不变 |
| **已局部改动再 apply** | 同上 | **rc=1**，`1 out of 4 hunks failed`；不带 dry-run 时前 3 个 hunk 会被写入 |
| **两种拒绝场景的 dry-run** | `--dry-run` | 均 rc=1，且**不写文件**（哈希不变），不产生 `.rej` |
| 反向 | `patch -R -p1 -N --batch` | rc=0，与原始文件逐字节相同（`cmp` rc=0） |
| 逻辑 + 形态测试 | `node test/helpers/prepare-host-fixtures.mjs` 后 `node test/workspaces-sessions-slot.test.mjs` | **18/18 通过，0 skip**（rc=0） |

测试内容（`test/workspaces-sessions-slot.test.mjs`）：

- A 组用**真实** `SlotCore`（从 `app.asar` 提取的暂存副本）：未声明 key 注册报错、空槽投影为 0、同 priority 冲突抛错、低 priority 遮蔽、dispose 后回落、注册/释放都通知订阅者（版本号 bump）、重复声明被拒、kind 决定注册契约、**A9 复刻 `SlotOutlet` single 分支决策**（`entriesOfSlot()[0]` 为空 → 原生 fallback；注册 → 占位者；遮蔽 → 遮蔽者；全释放 → 回 fallback），并验证该切换由 subscribe 驱动。
- B 组对补丁文本与打过补丁的产物做结构断言：只改 `lib/client.js` 且 4 hunk、只删 1 行、子槽声明落在 `children` 表、搜索分支与 `wide` 守卫未被改写、owner 字段齐全、原生 `FlatList`/`SessionTree`/row 插槽/`SearchResults`/`openSessionMenu` 全部仍在。

**未覆盖**（本运行环境缺少设施，不声称已验）：

- 不测试 React 渲染与 DOM 结果（无 React/DOM 运行时，未作假 DOM 测试）。
- 未在真实 Electron 进程内验证「插件注册后 sidebar 的实际像素表现」——这需要安装补丁并重启应用，超出本次授权。
- 未验证 `hookContext` 在 contextual inject entry 上的端到端行为（只核对了 renderer 的判定条件 `Object.hasOwn(opts, "hookContext")`）。

## 9. 风险与回滚

1. **升级失配**：补丁按字节锚定 `0.2.2-rc.1`；升级后 `patch` 会失败（这正是期望行为）。不要用 `-l`/模糊匹配强打。
2. **asar 封装**：本机该包在 `app.asar` 内，真实安装需要宿主维护流程解包再封包，并保持 asar 完整性；本次未做，也未触碰 `/Applications` 与 `~/.dsh`。
3. **单占位冲突**：插件若在 priority 0 注册两次（例如热重载未清理旧 registration），第二次会抛错；插件应在 dispose 时释放 registration。
4. **滚动/背景**：occupant 若自绘背景或依赖原生 `.list` 的滚动样式，会出现视觉偏差（见第 7 节）；这不是补丁缺陷，但属验收重点。
5. **窄态无 override**：rail 模式下插件不渲染，若产品要求 rail 也变，需要另开设计（当前明确不做）。
6. **回滚成本低**：单文件、单处挂载点，`patch -R` 或还原备份即可，无数据迁移、无 store 变更。

## 10. 相关文件

- `patches/0001-sidebar-workspaces-sessions-slot.patch` — 补丁本体
- `test/workspaces-sessions-slot.test.mjs` — 上述测试
- `.stage-hostpatch/tools/{asar-extract.mjs,make-patched.mjs}` — 提取与生成脚本（工作区临时，未入库）

---

# 补丁 0002：`sidebar.navigation.action` 导航动作行扩展点

**状态**：同上——仅在工作区准备，**未应用、未提交、未部署**，`/Applications` 与 `~/.dsh` 未改动。

## B1. 为什么需要它（为什么不复用已有槽）

原「活动视图」入口是插件自己在 `sidebar.panellist` 图标上挂 `onClick`，或注册一个未声明的 global panel 来抢 native nav 位置。两条路都不成立：

| 现状 | 事实 | 结论 |
| --- | --- | --- |
| `sidebar.panellist`（`PanelRow`，`lib/client.js:207-238`） | 行是硬编码 `<button onClick={() => selectPanel(id)}>`；该槽只渲染 **glyph**，且 glyph 包在 `aria-hidden` 容器里；props 仅 `{ size, active }` | 既拿不到点击回调（被 `selectPanel` 吃掉），也不能可靠接收指针事件 / 无障碍焦点 |
| `sidebar.panellist.actions` | 行渲染在「More」弹出的菜单里，走 `onOpen(panelId)` 语义；且整块受 `hasEntryActions` 门控 | 会**隐藏原活动入口**，与「保留原生功能」冲突 |
| `sidebar.footer.action` | 位置在 footer | 用户明确要求底区保留，新增会挤占原 footer |
| 注册 global panel | 旧版做法 | 会在 nav 里冒出非原生面板，触发 `NewSession` 一类跳转，已明确禁止 |

结论：ui-sidebar **没有任何**可用的自由形态导航动作 registry，因此在原生 `nav.panelList` 内追加**一个** list/root 子槽是最小正确路径。

## B2. 版本锁定与适用性

| 项 | 值 |
| --- | --- |
| 包 | `@deepseek-ai/dsh-client-ui-sidebar` |
| 版本 | `0.2.2-rc.1` |
| 目标文件 | `lib/client.js` |
| 原始大小 / sha256 | 43911 B / `b6085dca1d2e1e48a3d4d8eaef609613af5201100552476c16119cd1ced136b1` |
| 打补丁后大小 / sha256 | 44387 B / `6ba788f80d4f7d9467318a08263bf626db5f3c6fc95f9a7cf786344e8399a1d1` |
| 补丁文件 | `patches/0002-sidebar-navigation-action-slot.patch`（`patch -p1`，路径 `lib/client.js`） |
| 规模 | 2 个 hunk，**净删 1 行**、新增 15 行（含上下文），纯插入 |

应用前先核对原文件 sha256；不一致（包已升级）**停止**，重新生成，不要 `-l` 强打。

## B3. 安装 / 回滚（工作目录 = 该包根，`-p1`）

必须 `-N --batch` **且先 dry-run**（理由同 0001 §3：不带 `-N` 时 `patch` 会猜成反向并返回 0）：

```bash
# 示例只用工作区副本（包根 = 含 lib/client.js 的目录）；真实 app.asar 解包/回包需另次授权。
mkdir -p /tmp/dsh-patch-try && cp -R .stage-hostpatch/stage/dsh-client-ui-sidebar /tmp/dsh-patch-try/
cd /tmp/dsh-patch-try/dsh-client-ui-sidebar
shasum -a 256 lib/client.js     # 必须 = b6085dca1d2e1e48…

patch -p1 -N --batch --dry-run < .../patches/0002-sidebar-navigation-action-slot.patch   # rc 必须 0
patch -p1 -N --batch          < .../patches/0002-sidebar-navigation-action-slot.patch   # rc 必须 0
shasum -a 256 lib/client.js     # 必须 = 6ba788f80d4f7d94…
node --check lib/client.js      # 需先复制为 .mjs（产物是 ESM）
```

回滚：`patch -R -p1 -N --batch < <补丁>`，或直接还原备份（本补丁无状态、无 store 变更）。

**拒绝套用**（已实测，见 B6 表）：

- 已打过 → `2 out of 2 hunks ignored`，rc=1，文件不变。
- 本机已局部改过 nav 附近 → `1 out of 2 hunks failed`，rc=1，留下 `.rej` 与 `.orig`；**dry-run 能先发现**，所以务必先 dry-run。

## B4. slot 合同（插件按此一次接入）

```
key:    sidebar.navigation.action
kind:   list
scope:  root
```

- 注册时必须带 `options.id`（list 槽的注册契约，缺 id 抛 `list slot ... requires options.id`）。
- 渲染时机：原生 `nav` 每次都调用 `renderSlot`；**0 个 occupant 时只留下 renderer 固定的 `<div data-slot="sidebar.navigation.action" style="display:contents">` 锚点**（`display:contents` 不产生布局盒，也没有 wrapper 或占位元素），原生 panel 行与 More 菜单的源码与顺序不变；**不承诺「零 DOM」或「逐字节/像素等价」**，实际像素表现**未 GUI 验证**。
- 只有一个渲染点：插在原生 panel 行 `panels.filter(...).map(...PanelRow...)` 之后、「More」`PanelMoreMenu` 之前，仍在原生 `<nav class="….panelList">` 的 children 数组里。
- outlet 是 `<div data-slot="sidebar.navigation.action" style="display: contents">`：**没有盒子**，occupant 渲染的 `<button>` 直接成为 `nav.panelList` 的 flex 项，因此必须自己给 `<button type="button">` 并套用下传的 native className。
- occupant 收到的 props（**精确形状**）：

  | prop | 类型 | 含义 / 用法 |
  | --- | --- | --- |
  | `wide` | `boolean` | 侧栏宽态。为 `false`（rail/收起）时请自行决定是否 `return null`（原生行此时只显示 glyph） |
  | `classes` | `object` | native className 合同，见下 |
  | `classes.panelRow` | `string` | 行容器样式（原生 panel 行同款：内边距、圆角、hover） |
  | `classes.panelActive` | `string` | 选中态（与原生 `activePanelId` 同一套样式，插件自己决定何时加） |
  | `classes.panelGlyph` | `string` | 图标位样式（尺寸/对齐） |
  | `classes.panelTitle` | `string` | 文字位样式（字号/省略号） |
  | `classes.wide` | `string` | 宽态修饰类 |

- 插件**必须自己提供**：`onClick` 回调、选中/开关语义（侧栏模式类用 `aria-pressed`；只有真正导航页面时才用 `aria-current`）、可访问名称（`aria-label` / 可见文字）、以及 `active` 判定。宿主不传任何回调，也不读插件状态。
- `classes.wide` 与原生一致，**加在标题 `span` 上**（原生是 `clsx(panelTitle, wide)`），不加在 `button` 上。
- 插件**不得**：注册 global panel；伪造 panel id；在 outlet 上自绘背景/固定定位（`display: contents` 会破坏布局）；假设自己一定在第一位（它是原生行之后的追加行）。
- 视觉合流示例（插件侧）：

  ```jsx
  ({ wide, classes }) => {
    if (!wide) return null;
    const active = isActivityMode();          // 插件自己的状态
    return (
      <button type="button"
        className={`${classes.panelRow} ${active ? classes.panelActive : ""}`}
        aria-pressed={active}
        aria-label={t("activityView.label")}
        onClick={toggleActivityMode}>
        <span className={classes.panelGlyph} aria-hidden="true">{icon}</span>
        {/* 与原生一致：classes.wide 加在标题 span 上（原生 clsx(panelTitle, wide)） */}
        <span className={`${classes.panelTitle} ${classes.wide}`}>{t("activityView.label")}</span>
      </button>
    );
  }
  ```

## B5. 与 0001 的关系 / 配套行为

- 两个补丁属**不同包**，互不依赖：0002 只加「入口行」，0001 只换「会话列表体」。可单独装，也可都装。
- 0002 **不改变**任何原生行为：`PanelRow` 逐字未变（仍 `selectPanel`、glyph 仍 `aria-hidden`）、`PanelMoreMenu` 未变、header/footer/brand/workspaces/settings 声明与渲染点数量均未变（测试 C3/C4/C5 断言）。
- 活动模式的排序/归档语义仍由插件落实，宿主只提供入口与（0001 的）列表体位置；`groupBy/orderBy` 菜单联动约定见 0001 §6.1，本补丁不新增该方面行为。

## B6. 已执行的验证（全部在工作区暂存副本 `.stage-hostpatch/verify5`）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| V1 干净产物 dry-run | `patch -p1 -N --batch --dry-run` | rc=0，文件不变 |
| V2 干净产物 apply | `patch -p1 -N --batch` | rc=0，44387 B，sha256 = `6ba788f80d4f7d94…` |
| V3 语法 | 复制为 `.mjs` 后 `node --check` | rc=0 |
| V4 已打过再 apply（dry-run） | 同上 | **rc=1**，`Ignoring previously applied (or reversed) patch.` + `2 out of 2 hunks ignored`，文件不变 |
| V5 反向 | `patch -R -p1 -N --batch` | rc=0，`cmp` 与原文件**逐字节相同** |
| V6 已局部改动 dry-run | 在 hunk1 上下文里插一行无关语句后 `--dry-run` | **rc=1**，`1 out of 2 hunks failed`，不写文件、不产生 `.rej` |
| V7 已局部改动真打 | 同上不带 dry-run | **rc=1**，写入了 hunk2 并留下 `.rej`/`.orig`（→ 只能靠备份还原，故必须先 dry-run） |
| V8 逻辑 + 形态测试 | `node test/helpers/prepare-host-fixtures.mjs` 后 `node test/sidebar-navigation-action-slot.test.mjs` | **15/15 通过，0 skip**（rc=0） |

测试内容（`test/sidebar-navigation-action-slot.test.mjs`）：

- A 组用**真实** `SlotCore`（`app.asar` 提取的暂存副本）：0 occupant ⇒ 0 winner（原生不变）；list 必须带 id；两个 id 共存（证明不是 single 槽）；逐个 dispose 后回到 0；未声明时注册被拒（证明必须宿主声明）；注册/释放都通知订阅者（`SlotOutlet` 的 `useSyncExternalStore` 依赖，通知是 microtask 批处理的）。
- B 组对补丁文本断言：2 hunk、只删 1 行、只碰 `lib/client.js`、不碰 footer/settings/workspaces/brand、不新增 `selectPanel`/`panels.push`/全局监听/prototype 改写、声明为 `kind: "list" / scope: "root"`、`classes` 含 5 个 native className。
- C 组对打补丁产物断言：`node --check` 通过；插槽调用位于 `nav.panelList` 内、紧跟原生行 map 之后、在 `PanelMoreMenu` 之前；四类原生渲染点数量不变；原生声明数量不变；`PanelRow` 函数体逐字未变。

**未覆盖 / 已明确不做的**：

- 不做 React/DOM 渲染测试（本环境无 React 运行时，也不造假定 DOM）。
- **GUI 未验证**：没有把补丁装进 `/Applications/DSH NEXT.app`（asar 解包/回包属宿主维护流程），因此「插件接入后 nav 里的实际像素表现」属**待验证**。
- `nav` 只在 `panels.length > 0` 时渲染；若某 profile 面板数为 0，动作行随之不出现（实际 profile 恒有原生面板，故记录为已知边界，不为此改结构）。
- 不提供多行布局策略（list 支持多 occupant，但位置与顺序由 priority/order 决定，视觉密度未调）。

## B7. 风险与回滚

1. **升级失配**：按字节锚定 `0.2.2-rc.1`，升级后 `patch` 失败即期望行为。
2. **局部改动误打**：真打会产生 `.rej` + 部分写入（V7）；务必先 dry-run，出错用备份还原。
3. **插件自绘样式**：outlet `display:contents`，自绘背景/定位会破坏 native 行布局——插件须只用下传 className（理由同 0001 §7）。
4. **重复注册**：同一 `id` 在相同 priority 注册两次会抛错；热重载要在 dispose 时释放。
5. **不改 core schema**：本补丁只多一行 `children` 声明，不动 `register` 契约、不 monkeypatch。
6. **回滚成本**：单文件、两处插入，`patch -R` 或还原备份即可。

## B8. 相关文件

- `patches/0002-sidebar-navigation-action-slot.patch` — 补丁本体（2 hunk）
- `test/sidebar-navigation-action-slot.test.mjs` — 上述 A/B/C 三组测试
- `test/helpers/prepare-host-fixtures.mjs` — **可复现**的 fixture 准备脚本（见文末「可复现 fixture 与测试」）
- `.stage-hostpatch/tools/make-patched-sidebar.mjs` — 当时的本地临时生成器（未入库，已被上面的脚本取代）
- `.stage-hostpatch/stage/dsh-client-ui-sidebar/lib/client.js` — 原始副本（`b6085dca…`）

---

# 可复现 fixture 与测试（两个补丁共用）

前面表格里的验证是在本机暂存副本上跑出来的；为了让**新机器 / 干净检出**也能稳定重现同样的断言，补丁测试不再依赖手工留下的临时目录，改为一个只读的准备脚本生成 fixture。

## C1. 一条命令准备 fixture

```bash
node test/helpers/prepare-host-fixtures.mjs          # 默认读 /Applications/DSH NEXT.app/Contents/Resources/app.asar
node test/helpers/prepare-host-fixtures.mjs --force  # 已有 fixture 时强制重建
node test/helpers/prepare-host-fixtures.mjs --asar /path/to/app.asar   # 指定其他归档
```

行为约束：

- **对 asar 只读**：用 `openSync`/`readSync` 解析 8 字节大小头 + JSON 头，只 `readSync` 需要的 3 个文件到内存，不调用 asar CLI，不解包整个归档。
- **绝不写** `/Applications`、`~/.dsh`，不修改 `app.asar` 本身；只写仓库内 `.stage-hostpatch/{stage,fixtures}`。
- **版本 + 全长 sha256 双锁**：三个包都必须是 `0.2.2-rc.1`，且原始文件 sha256 与下表完整比对；任一不匹配即失败（不做「差不多就行」的降级）。

| fixture | 来源（asar 内） | sha256（完整） |
| --- | --- | --- |
| `stage/ui-slots/lib/index.js` | `node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js` | `57e1314e31a2015f30231e1e7596da658f1bb5cb64c103c4cf13381647412c99` |
| `stage/ui-workspace/lib/client.js` | `…/dsh-client-ui-workspace/lib/client.js` | `89b32d7916cb56dacb40d36d91fadbd627c1890fe84eb357a5ba9bfdd21c901b` |
| `fixtures/ui-workspace/lib/client.js` | 上面这份 + 补丁 0001 | `fc8521e1394cb762ce581fb3375286e65bd02edcb807839af7260a59a6f78e0b` |
| `stage/dsh-client-ui-sidebar/lib/client.js` | `…/dsh-client-ui-sidebar/lib/client.js` | `b6085dca1d2e1e48a3d4d8eaef609613af5201100552476c16119cd1ced136b1` |
| `fixtures/ui-sidebar/lib/client.js` | 上面这份 + 补丁 0002 | `6ba788f80d4f7d9467318a08263bf626db5f3c6fc95f9a7cf786344e8399a1d1` |

生成顺序（每个包独立完成，失败即整体退出）：拷贝原始文件 → `patch -p1 -N --batch --dry-run` **必须先 rc=0** → 再真打 → 校验产物 sha256 → 复制成 `.mjs` 跑 `node --check` → 清理 `.orig`/`.rej` → 写 `fixtures/manifest.json`。

## C2. 退出码

| 码 | 含义 |
| --- | --- |
| `0` | 全部 fixture 就绪 |
| `2` | 用法错误（未知参数） |
| `3` | asar 打不开 / 条目不存在 |
| `4` | 包版本或原始 sha256 不匹配（归档不是被锁定的 `0.2.2-rc.1`） |
| `5` | `patch` dry-run 或真打失败（补丁与产物已不匹配） |
| `6` | 产物 `node --check` 失败（打出来的不是合法 ESM） |

## C3. 跑测试（无 skip）

```bash
node test/workspaces-sessions-slot.test.mjs          # 0001：18 项
node test/sidebar-navigation-action-slot.test.mjs     # 0002：15 项
```

- fixture 齐全时：`18` / `15` 全通过，`rc=0`，**0 skip**。
- fixture 缺失时：**直接失败 `rc=1`**，并打印准备命令——默认不会「跳过产物断言后照样绿」。
- 只有显式加 `--allow-skip`（用于只想跑一遍补丁文本断言）才降级为 skip，且会显著打印降级提示。
