# DSH Activity View

**DSH 活动视图** — 把 DeepSeek Harness 左侧「工作区 / 会话」列表的**列表主体**换成活动视图：运行中的会话置顶在最上方（带正圆旋转标记），其余按最近活动时间倒序分成「今天 / 昨天 / 更早」，每行显示会话标题与所属工作区名。原生搜索栏（toolbar）与底部（footer）保持原位不动；点侧栏面板列表里的「活动视图」按钮打开（Alt+Shift+A 同效），再点一次或按 Esc 关闭，关闭后原样回到原生列表。

![活动视图侧栏：运行中会话置顶并带正圆旋转标记，其余按今天 / 昨天 / 更早分组](docs/images/activity-view.webp)

*截图取自真实界面，会话标题与工作区名已打码（已获作者授权公开用于本 README），仅用于展示布局与分组。*

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
## English

A community UI plugin for DeepSeek Harness, packaged as `dsh-activity-view`. It replaces the **body of the left workspace/session list** with a flat, activity-sorted list — the native search toolbar and footer stay exactly where they are:

- **Running sessions pinned once**: active sessions sit in a top block with a circular spinner (12×12 glyph inside the original 16×20 icon slot) and are **not** repeated in the date groups below.
- **Date groups for the rest**: Today / Yesterday / Earlier; each row shows the session title plus its workspace (cwd basename), and the workspace is skipped when it duplicates the title.
- **Click to open**: clicking a row opens that session in place through the host `uiWorkspace` service — no new session is created.
- **Live updates**: the list republishes on session-list changes and polls on a timer, so it stays current without a manual refresh.
- **Your own view choice wins**: if you change *group by* / *order by* in the native menu, the plugin steps aside and the native list renders your choice; it never writes back to that setting.

### Install

Install straight from this repository through the DSH plugin manager:

```
plugin_manager install_bundle github:bloodtmai-cmyk/dsh-activity-view
```

The repo carries the `dsh-plugin` topic, so the marketplace index picks it up too. It requires `engines.dsh = 0.2.2-rc.1` to match your host runtime **exactly**: on any other runtime the plugin manager skips the whole bundle (`skippedBundles`), so nothing is patched and the native UI stays untouched — safe, but inert.

### Structure

- `cordis.patch.yml` — disables the native `ui-sidebar` and `ui-workspace` rows by id (`disabled: true`, their config is not touched) and inserts `./compat/ui-workspace/lib/index.js`, `./compat/ui-sidebar/lib/index.js` and `dsh-activity-view`. Removing the bundle puts the native rows back.
- `compat/ui-workspace`, `compat/ui-sidebar` — MIT-licensed vendored copies of the host's own UI packages (LICENSE kept inside each package, upstream build comments left untouched), each carrying one extra slot: an outlet in the session-list body whose `fallback` is the native `FlatList`. `compat/vendor-lock.json` records the host build they were cut from.
- `patches/` — the canonical patches applied to those vendored sources, and what each one changes.
- `sidebar.workspaces` is a `single` slot owned by the shell's own sidebar entry, so a third-party registration would only leave an inactive occupant. That is why the list body is served from the vendored packages instead of an overlay: there is no floating panel and no styling pushed onto `documentElement` — the outlet is a `display: contents` element inside the native column, so it inherits the real row height, left inset, font and colour.
- Duplicate rows are folded twice: ids are normalised (`session-<uuid>` vs `<uuid>`) and de-duplicated, then rows whose normalised title prefix and workspace match are collapsed with a running row winning. Placeholder titles never merge, so genuinely distinct sessions stay visible.

### Compatibility & caveats

- The compat packages are patched against the host's internal module layout, recorded in `compat/vendor-lock.json`. **A host upgrade can invalidate them** — re-verify after upgrading instead of assuming they still work.
- Writing files into the profile directory does not mean the running page has loaded them: there is no verified asset watcher or HMR here. Judge by the host's own observable state (a new config row, a new client slot, the content of the loaded asset), and restart the host when that is what your setup requires.
- Verified only against the host build recorded in `compat/vendor-lock.json`; other builds are unverified, not guaranteed.

## 简体中文

### 功能

- **列表主体替换**：原生「工作区 / 会话」列表的列表体换成活动视图；搜索栏与 footer 不动，不遮挡、不浮层。
- **置顶只出现一次**：运行中的会话集中在最上方一块，左侧仍是原生 16×20 图标槽位，图标为正圆运行标记（12×12 画面、半径 6.5、1.5 描边、圆头端点，绕自身中心旋转）；这些会话不会再重复出现在下面的日期分组里。
- **其余按日期分组**：今天 / 昨天 / 更早；每行 = 会话标题 + 工作区名（与标题重复时省略）。
- **点行即开**：走宿主 `uiWorkspace` 就地打开该会话，不新建会话。
- **自动跟随**：会话列表变化即重绘，并按定时器轮询，无需手动刷新。
- **尊重你的原生选择**：你在原生菜单里改「分组方式 / 排序」后，插件退出活动模式，由原生列表按你的选择渲染，插件不回写。

### 安装

```
plugin_manager install_bundle github:bloodtmai-cmyk/dsh-activity-view
```

要求宿主运行时与 `package.json` 的 `engines.dsh = 0.2.2-rc.1` **精确匹配**。不匹配时整个 bundle 会被 `loadProfileDirectory()` 跳过（`skippedBundles`）：补丁一行都不生效、原生 UI 原样保留——不会出现「原生关了、兼容包没上」的空白，但也不会有任何功能。

### 兼容与限制（如实说明，不承诺零风险）

- `compat/` 下两个包是宿主 `ui-sidebar` / `ui-workspace` 的 MIT 内联副本（各自保留 LICENSE、保留上游构建注释，未改 vendor 字节），只各加了一个 slot：会话列表体里的 outlet，`fallback` 是原生 `FlatList`。**宿主升级后这些补丁可能失配**，升级后请重新校验，不要假定仍可用。
- 文件写进 profile 目录 **不等于** 当前页面已加载新 asset：本机没有经核实的 asset watcher / HMR。判据是宿主侧可观察状态（Host Config 出现新 row、Client Slots 出现新 slot、加载到的 asset 内容是否为新版）；需要时按你的授权重启 / 重建宿主再判读。
- 仅在 `compat/vendor-lock.json` 记录的宿主构建上验证过，其它构建未验证、不保证。
