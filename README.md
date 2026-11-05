# DSH Activity View

**DSH 活动视图** — 把 DeepSeek Harness 左侧「工作区 / 会话」列表的**列表主体**换成活动视图：顶部是被手动置顶的会话（不带分组标题），其余按「今天 / 昨天 / 更早」分组，组内运行中的会话排在前面并带圆形运行标记。原生列表的其余结构（工具栏、搜索、视图选项等）保持原生。

![活动视图侧栏：日期分组、工作区标签与运行状态（会话信息已打码）](docs/images/activity-view.webp)

*截图中会话信息已打码。*

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
## English

A community UI plugin for DeepSeek Harness, packaged as `dsh-activity-view`. It registers as the occupant of the host slot `sidebar.workspaces.sessions`, so only the session-list body is replaced — the surrounding native chrome (toolbar, search, view options, workspace controls, per-row buttons and menus) stays native.

- **Pinned block on top**: sessions you pinned in the native UI (the official `pinnedSessionIds` set, archived ones excluded) are lifted into a header-less block at the top, each shown once, and they do not consume the 25-row budget that applies to ordinary rows.
- **Everything else by date**: the remaining sessions are grouped Today / Yesterday / Earlier by their official activity time (`updatedAt`), newest first. Inside a group, running sessions come first and carry a circular running marker; a running row shows no relative time. Ordinary running sessions therefore always sit at the top of Today, however old their `updatedAt` is — the stored timestamps themselves are never rewritten.
- **Only official ids**: rows are de-duplicated by the exact official row id — `session-<uuid>` and `<uuid>` are not normalised into each other, and rows that merely share a title or a workspace are never merged. Sub-agent rows are not listed.
- **Where the data comes from**: the list renders the host snapshot passed in through props (falling back to the official `ctx.sessions.list` snapshot when no props are supplied) and re-renders as the host republishes it. A one-minute local clock only refreshes relative times and the Today/Yesterday boundary — it is not a data poll.
- **Your view choice wins**: changing *group by* / *order by* in the native menu makes the plugin step aside so the native list renders your choice; it never writes back to that setting.

### Install

Install straight from this repository through the DSH plugin manager:

```
plugin_manager install_bundle github:bloodtmai-cmyk/dsh-activity-view
```

The repo carries the `dsh-plugin` topic, so the marketplace index picks it up too. It requires `engines.dsh = 0.2.2-rc.1` to match your host runtime **exactly**: on any other runtime the plugin manager skips the whole bundle (`skippedBundles`), so nothing is patched and the native UI stays untouched.

### Structure

- `patches/0001-sidebar-workspaces-sessions-slot.patch` — adds the `sidebar.workspaces.sessions` child slot to `ui-workspace`, moving the whole native list into the slot's `fallback` so an unoccupied slot still renders the original list.
- `patches/0002-sidebar-navigation-action-slot.patch` — adds the `sidebar.navigation.action` slot to `ui-sidebar`: one navigation action row (after the native panel rows, before "More") that toggles activity mode.
- `compat/ui-workspace`, `compat/ui-sidebar` — MIT-licensed vendored copies of the host's own UI packages (LICENSE kept inside each package) carrying exactly those two patches; `compat/vendor-lock.json` records the host build they were cut from.
- `cordis.patch.yml` — disables the native `ui-sidebar` / `ui-workspace` rows by id and inserts the two compat packages plus `dsh-activity-view`. Removing the bundle puts the native rows back.
- The plugin paints no overlay and reads no host DOM: the slot outlet is a `display: contents` element inside the native column, so rows inherit the native height, inset, font and colour, and the native scroll container stays in charge when the slot is unoccupied.

### Compatibility & caveats

- Version matching only decides whether the bundle loads at all. It does not guarantee that patching, module import and slot declaration all succeed on your machine: if any of those steps fails (file IO, import error, an undeclared slot, another occupant at the same priority), that region can end up empty or fall back to the native list. Check the host's own observable state before judging the UI.
- The compat packages are patched against the host's internal module layout; a host upgrade can invalidate them. Re-verify after upgrading instead of assuming they still work.

## 简体中文

### 功能

- **列表主体替换**：插件只占用宿主插槽 `sidebar.workspaces.sessions`，替换会话列表的列表体；工具栏、搜索、视图选项、workspace 控件、行内按钮与右键菜单都还是原生的。
- **置顶块在最上方**：你在原生界面里手动置顶的会话（官方 `pinnedSessionIds`，归档的不进这块）被提到顶部，不带分组标题、只出现一次，也不占普通行的 25 行上限。
- **其余按日期**：剩下的会话按官方活动时间 `updatedAt` 分成今天 / 昨天 / 更早，越新越前；组内运行中的会话排在前面并带圆形运行标记，运行中的行不显示相对时间。因此普通运行会话始终排在「今天」组内靠前，即使它的 `updatedAt` 较早；历史时间戳本身不会被改写。
- **只认官方 id**：去重只按官方行 id 精确匹配——`session-<uuid>` 与 `<uuid>` 不互相归一，标题或工作区相同但 id 不同的会话不会被合并；子代理行不列出。
- **数据来源**：列表渲染宿主通过 props 传入的原生快照（没有 props 时退回官方 `ctx.sessions.list` 快照），随宿主重新发布而重渲染；分钟级本地时钟只推进相对时间与「今天 / 昨天」的边界，不是数据轮询。
- **尊重你的原生选择**：你在原生菜单改「分组方式 / 排序」后，插件退出活动模式，由原生列表按你的选择渲染，插件不回写。

### 安装

```
plugin_manager install_bundle github:bloodtmai-cmyk/dsh-activity-view
```

要求宿主运行时与 `package.json` 的 `engines.dsh = 0.2.2-rc.1` **精确匹配**。不匹配时整个 bundle 会被 `loadProfileDirectory()` 跳过（`skippedBundles`）：补丁一行都不生效、原生 UI 原样保留。

### 兼容与限制

- 版本匹配只决定 bundle 能不能加载，**不保证**打补丁、模块导入、插槽声明在你这里都成功：任一步失败（文件读写、导入报错、插槽未声明、同 priority 已被占用）都可能让该区域没有内容或退回原生列表。判断前先看宿主侧可观察状态。
- `compat/` 两个包按宿主内部模块结构打补丁，宿主升级后可能失配；升级后请重新校验，不要假定仍可用。
