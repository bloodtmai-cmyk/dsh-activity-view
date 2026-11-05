# @local/activity-ui-sidebar

DSH 内置侧边栏 UI（`@deepseek-ai/dsh-client-ui-sidebar`）的**本地兼容副本**，唯一目的是让
`sidebar.navigation.action`（导航动作行）插槽存在，从而让本仓库的导航动作条能挂进侧边栏。

## 它不是"重写的 UI"

- `lib/client.js` = 原生 bundle **逐字节 + 已审补丁 + 命名空间替换**，没有其它任何改动。
- `lib/index.js`、`LICENSE`、`locale/*.json` 与原生文件**逐字节相同**（宿主侧 `apply()` 本来就是空函数）。
- 因此行为与内置侧边栏完全一致：会话树、搜索、分组、状态点、面板列表、快捷方式、locale 命名空间全部来自原生实现。

## 来源与锁版

| 项 | 值 |
| --- | --- |
| 原生包 | `@deepseek-ai/dsh-client-ui-sidebar` |
| 原生版本 | `0.2.2-rc.1` |
| 取源文件 | `/Applications/DSH NEXT.app/Contents/Resources/app.asar` → `node_modules/<原生包>/` |
| 应用版本 | `2.0.22-next` |
| 补丁 | `../../patches/0002-sidebar-navigation-action-slot.patch` |
| 逐文件 sha256 | `../vendor-lock.json` 的 `packages["@deepseek-ai/dsh-client-ui-sidebar"].files` |
| 许可 | MIT（`LICENSE` 为原生文件原样副本） |
| `engines.dsh` | `0.2.2-rc.1`，与 root bundle 的约束一致；这只是版本声明，**不保证**导入/组合一定成功 |

补丁内容只有两处：

1. `renderSlot("sidebar.navigation.action", …)` 插到每条面板行末尾（`wide`、`classes` 由原生侧提供）。
2. `slots.inject` 的插槽声明表里登记 `"sidebar.navigation.action": { kind: "list", scope: "root" }`。

## 命名空间替换

把原生包名字面量整体替换为本包名，共 5 处，全部是"自身身份"字符串：

- bundle 的 `id:`（浏览器模块 id 必须等于 manifest 包名）
- 两个 CSS 注入点的 `tagId` 与 `tag.dataset.plugin`（`HeaderLeadingControls.module.css`、`SidebarRoot.module.css`）

`const NS = "sidebar"` **刻意保留原值**：它是原生 locale 契约（`ctx.locale.register(NS, …)`，
并作为 `locale: NS` 传给插槽），其它包往 `sidebar.panellist` 等插槽注册的子项会按这个命名空间
解析裸 label key。改名会让这些文案静默丢失，所以这里选择保留。

## 重新生成 / 校验

```bash
node compat/lib/build.mjs          # 重新生成（需要已安装的 DSH NEXT.app）
node compat/lib/build.mjs --check  # 只校验：产物必须与"原生 + 补丁 + 替换"重建结果逐字节相同
```

`--check` 同时充当**白名单测试**：只要有人在这个包里手写了原生代码之外的东西，它就会失败。

配套契约测试（只跑这一个文件，够用）：

```bash
node --test --test-isolation=none test/compat-packages.test.mjs
```

它检查的是**导出与样式标记的形状**（loader.load 入参 id、`apply`/`inject` 形状、`<style>` 的
`data-plugin`/`data-plugin-css`）以及"未改字节的 `lib/index.js`、`LICENSE`、`locale/*.json`
与 vendor-lock 记录的 sha256 一致"。测试用万能 `require` 桩与假 `document`，因此**不能**据此说
"包在真实 Loader / 浏览器里可装载"——那一层只能在 GUI 验收时确认。

原生 asar 缺失时该测试默认**失败**并打印标准构建命令（先装对应版本应用，再 `node compat/lib/build.mjs --check`，
换机用 `--asar <app.asar>`）；只有显式 `DSH_COMPAT_ALLOW_SKIP_ASAR=1` 才跳过，跳过即视为未验证可复现性。

## 可维护性限制（务必先读）

- **应用升级即失效**：`vendor-lock.json` 锁定了 `2.0.22-next` 的 asar 与逐文件 sha256。升级 DSH 后
  `build.mjs` 会以退出码 4 拒绝构建，必须先复核新原生 bundle、必要时重做补丁，再重新锁版。
- **补丁靠上下文行匹配**：原生 `lib/client.js` 一旦改动，补丁会以退出码 5 失败（而不是静默错位），
  需人工核对后重新生成补丁。
- **没有类型与源码**：原生 `lib/types/**`、`src/**` 未随包分发（本包不导出 `types`），编辑体验弱于原生包。
- **不得与原生包同时启用**：同一包名只允许一个活动来源；本包用不同包名共存，因此必须停用原生
  `include:ui-sidebar` 行并插入本包，否则会出现两份侧边栏。组合方式由仓库的 `cordis.patch.yml` 负责，
  不在本包内。
- **不是上游分叉**：这是发布期打点副本，不承担功能演进；上游行为变化应回落到原生包。
