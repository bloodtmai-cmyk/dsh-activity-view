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
- `sidebar.workspaces` is a `single` slot owned by the shell's own sidebar entry, and the slot catalog states that *declaring is claiming*: a plugin registration — at apply time or at runtime — only leaves an inactive occupant, so the native browser keeps rendering. That is why this plugin does not try to take the slot.
  Instead it mounts a panel **inside the native session-list container** (located by matching the known session titles inside the left column, skipping any container that also holds the New-session/workspace header). Native rows are hidden with `visibility: hidden`, the container is switched to `position: relative; overflow: hidden`, and the panel is positioned with `inset: 0`, so edges, width, font, colours and background all come from the real sidebar — no measurement and no separate white card. Removing the panel restores the native list exactly.
- Because the panel lives inside the sidebar subtree rather than a slot, theme and font changes are inherited automatically, and the panel is re-attached on every store update if the host re-renders the container. A fixed-position fallback (mounted on `document.documentElement`) is used only when the native list container cannot be found.
