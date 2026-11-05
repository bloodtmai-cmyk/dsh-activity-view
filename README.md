# DSH Activity View

**DSH 活动视图** — 在 DeepSeek Harness 侧栏新增一个活动视图图标，把左侧会话列表切换为按活跃度排列的扁平列表：当前运行中的会话置顶（带动态旋转标记），其余按最近活动时间倒序，每行显示会话标题与所属项目（工作区）名。

[English](#english) · [简体中文](#简体中文)

<a id="english"></a>
## English

A community UI plugin for DeepSeek Harness, packaged as `dsh-activity-view`. Click the activity-view icon in the sidebar panel list to replace the host session list with a flat list sorted by activity:

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

- `cordis.patch.yml` — Cordis bundle patch: inserts the sidebar panel-list icon and the workspace-list slot replacement.
- `client.js` — the entire client half: data loading, sorting, rendering, and document-level click capture (host slots swallow React `onClick`).
- `index.js` — host half (no host-side work needed).
- `locale/{en,zh}.json` — localized meta and labels.
- `icon.svg` — clock glyph using `currentColor`.

<a id="简体中文"></a>
## 简体中文

面向 DeepSeek Harness 的社区 UI 插件（包名发布前请自行改名）。点击侧栏面板列表上的活动视图图标，即可把宿主会话列表替换为按活跃度排序的扁平列表：

- **活动会话置顶**：正在运行的会话排在最前面，带旋转动画标记。
- **每行带项目名**：每行显示会话标题与所属项目（工作区目录名）；与标题重复时自动省略。
- **点击进入会话**：点击某行通过宿主 `uiWorkspace` 服务原地打开该会话，不会新开会话。
- **动态刷新**：会话列表变化时实时重发布，并按定时器轮询，无需手动刷新。

### 安装

在 DSH 插件管理器里直接用仓库地址安装：

```
plugin_manager install_bundle github:bloodtmai-cmyk/dsh-activity-view
```

仓库带有 `dsh-plugin` 主题，因此也会进入套件市场索引。要求宿主支持客户端注入（`locale`、`timer`、`sessions`、`layout`、`uiWorkspace`）。

## License

MIT
