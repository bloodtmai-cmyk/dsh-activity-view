# DSH Activity View

**DSH 活动视图** — 在 DeepSeek Harness 左侧工作区/会话列表的位置显示一个按活跃度排列的活动视图：当前运行中的会话置顶（带动态旋转标记），其余按最近活动时间倒序，每行显示会话标题与所属项目（工作区）名，按今天/昨天/更早分组。点侧栏面板列表里的「活动视图」按钮打开（也可按 Alt+Shift+A），再点一次或按 Esc 关闭，关闭后原样露出原生列表。

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
## English

A community UI plugin for DeepSeek Harness, packaged as `dsh-activity-view`. Shows a flat, activity-sorted session list (Today/Yesterday/Earlier, workspace name per row, running sessions pinned on top) exactly where the left workspace/session list sits. Click the activity-view button in the sidebar panel list to open it (Alt+Shift+A also works), click again or press Esc to restore the native list:

- **Running first**: sessions with active work are pinned at the top with an animated spinner.
- **Project name per row**: each row shows the session title plus its workspace (cwd basename); the workspace span is skipped when it duplicates the title.
- **Click to open**: clicking a row opens that session in place via the host `uiWorkspace` service — no new session is created.
- **Live updates**: the list republishes on session-list changes and polls on a timer, so it stays current without manual refresh.

### Install

Install straight from this repository through the DSH plugin manager:

```
plugin_manager install_bundle github:bloodtmai-cmyk/dsh-activity-view
```

The repo carries the `dsh-plugin` topic, so it is also picked up by the marketplace index. Requires a DeepSeek Harness host with client injection support (`locale`, `timer`, `sessions`, `layout`, `uiWorkspace`).

### Structure

- `cordis.patch.yml` — Cordis bundle patch: inserts the plugin row.
- The plugin keeps its icon in `sidebar.panellist` and, on click, registers its own React list into `sidebar.workspaces` with a high priority (`id: activity-view-workspaces`, `priority: 1000`). Clicking again disposes that registration so the native browser returns untouched. Registering **at click time** (rather than at apply time) is what makes the shell accept the occupant.
- Because the list is a real slot occupant rendered by the sidebar, geometry, font and colours are the shell's own: no measured rectangle, no separate card, no overlay.
- Duplicate rows are folded twice — ids are normalised (`session-<uuid>` vs `<uuid>`) and de-duplicated, then rows whose normalised title prefix and workspace match are collapsed with a running row winning. Placeholder titles never merge, so genuinely distinct sessions stay visible.
