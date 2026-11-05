#!/usr/bin/env node
/**
 * 宿主补丁 0002（ui-sidebar 导航动作行 slot）的真实逻辑测试。
 *
 * 三类断言：
 *  A. 用**真实的** SlotCore（暂存副本 .stage-hostpatch/stage/ui-slots/lib/index.js）
 *     验证 `sidebar.navigation.action` 的 list/root 语义：
 *     无 occupant = 0 条（原生完全不变）、多行按 id 共存、dispose 全部后回到 0 条、
 *     list 必须带 id、未声明时注册被拒（证明该 key 需要宿主声明）。
 *  B. 对补丁文本做形态断言：只改 nav 内的 children 数组 + children 声明表两处；
 *     不改 header/footer/brand/workspaces，不注册 global panel，不 monkeypatch。
 *  C. 对打补丁后的构建产物做结构断言：插槽调用点在 nav.panelList 内、位于原生行之后
 *     More 菜单之前，且传入 wide 与 native className 合同；产物可被 node --check 解析。
 *
 * 不测 React 渲染（此处无 React/DOM 运行时，也不造假定 DOM）。
 * fixture 由 test/helpers/prepare-host-fixtures.mjs 生成；缺失时默认 fail（exit 1），
 * 只有显式 --allow-skip 才降级跳过。
 *
 * 运行：node test/sidebar-navigation-action-slot.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FIXTURES, ensureFixtures } from './helpers/fixtures.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOTS = FIXTURES.slots;
const PATCH = join(REPO, 'patches/0002-sidebar-navigation-action-slot.patch');
const PRISTINE = FIXTURES.sidebarPristine;
const PATCHED = FIXTURES.sidebarPatched;

const SLOT_KEY = 'sidebar.navigation.action';
const failures = [];
let passed = 0;
const skipped = [];

async function test(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`  ok  ${name}`);
	} catch (error) {
		failures.push(`${name}: ${error.message}`);
		console.log(`  FAIL ${name}\n       ${error.message}`);
	}
}
function skip(name, why) {
	skipped.push(`${name}（${why}）`);
	console.log(`  skip ${name}`);
}

const patchText = readFileSync(PATCH, 'utf8');
const addedLines = patchText.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
const removedLines = patchText.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));

// ───────────────────────── A. 真实 slot 注册表语义（list/root） ─────────────────────────

/** 模拟宿主：root entry 的 children 表声明该子槽（补丁加的就是这一行声明）。 */
function makeHost(core, { declare = true } = {}) {
	const children = { 'sidebar.panellist.actions': { kind: 'list', scope: 'root' } };
	if (declare) children[SLOT_KEY] = { kind: 'list', scope: 'root' };
	return core.register(
		{ name: 'root', children, inject: {}, locale: 'ns' },
		function Parent() { return null; },
	);
}

if (ensureFixtures(['slots'])) {
	const { SlotCore } = await import(pathToFileURL(SLOTS).href);

	await test('A1 无 occupant 时该 slot 完全为空（原生 nav 不变）', () => {
		const core = new SlotCore();
		makeHost(core);
		assert.deepEqual(core.spec(SLOT_KEY), { kind: 'list', scope: 'root' });
		assert.deepEqual(core.entriesOfSlot(SLOT_KEY), []);
		assert.equal(core.entries(SLOT_KEY).length, 0);
	});

	await test('A2 list 必须带 id，且多行按 id 共存', () => {
		const core = new SlotCore();
		makeHost(core);
		assert.throws(() => core.register({ name: SLOT_KEY }, () => null), /requires options\.id/);
		core.register({ name: SLOT_KEY, id: 'activity-view' }, () => 'row-1');
		core.register({ name: SLOT_KEY, id: 'other' }, () => 'row-2');
		const entries = core.entriesOfSlot(SLOT_KEY);
		assert.equal(entries.length, 2, '两个 id 应共存（不是 single 槽）');
		const ids = entries.map((e) => e.options.id).sort();
		assert.deepEqual(ids, ['activity-view', 'other']);
	});

	await test('A3 dispose 全部行后回到 0 条（插件停用即恢复原状）', () => {
		const core = new SlotCore();
		makeHost(core);
		const d1 = core.register({ name: SLOT_KEY, id: 'a' }, () => 'a');
		const d2 = core.register({ name: SLOT_KEY, id: 'b' }, () => 'b');
		assert.equal(core.entriesOfSlot(SLOT_KEY).length, 2);
		d1();
		assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1);
		d2();
		assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0);
	});

	await test('A4 未声明该 key 时注册被拒（说明必须由宿主声明，不能插件自造）', () => {
		const core = new SlotCore();
		makeHost(core, { declare: false });
		assert.throws(() => core.register({ name: SLOT_KEY, id: 'x' }, () => null), /not declared/);
	});

	await test('A5 注册/dispose 会通知订阅者（SlotOutlet 的 useSyncExternalStore 依赖）', async () => {
		const core = new SlotCore();
		makeHost(core);
		let hits = 0;
		const off = core.subscribe(SLOT_KEY, () => { hits += 1; });
		const done = core.register({ name: SLOT_KEY, id: 'activity-view' }, () => 'row');
		await new Promise((r) => setTimeout(r, 0)); // 通知是 microtask 批处理的，等一拍
		done();
		await new Promise((r) => setTimeout(r, 0));
		off();
		assert.ok(hits >= 2, `订阅至少被通知 2 次，实际 ${hits}`);
	});
} else {
	skip('A1-A5 slot 语义', '缺少 slot fixture（已 --allow-skip）');
}

// ───────────────────────── B. 补丁文本形态 ─────────────────────────

await test('B1 补丁只新增：2 个 hunk，仅 1 行被改写（插入插槽调用）', () => {
	const hunks = patchText.split('\n').filter((l) => l.startsWith('@@'));
	assert.equal(hunks.length, 2, `期望 2 个 hunk，实际 ${hunks.length}`);
	assert.equal(removedLines.length, 1, `期望只删除 1 行，实际 ${removedLines.length}`);
	assert.match(removedLines[0], /hasEntryActions && \(0, react_jsx_runtime\.jsx\)\(PanelMoreMenu, \{/);
});

await test('B2 补丁读写路径只涉及 ui-sidebar 的 lib/client.js', () => {
	const files = patchText.split('\n').filter((l) => l.startsWith('--- ') || l.startsWith('+++ '));
	assert.deepEqual(files, ['--- a/lib/client.js', '+++ b/lib/client.js']);
});

await test('B3 补丁不碰 header / footer / brand / workspaces 行', () => {
	for (const line of [...addedLines, ...removedLines]) {
		assert.ok(!/sidebar\.footer\.action/.test(line), `不应改动 footer：${line}`);
		assert.ok(!/sidebar\.settings/.test(line), `不应改动 settings：${line}`);
		assert.ok(!/sidebar\.workspaces/.test(line), `不应改动 workspaces：${line}`);
		assert.ok(!/sidebar\.brand\./.test(line), `不应改动 brand：${line}`);
	}
});

await test('B4 补丁不新增 global panel、不改 selectPanel 行为、不做全局 capture', () => {
	for (const line of addedLines) {
		assert.ok(!/ctx\.layout\.selectPanel/.test(line), `不应新增 selectPanel 调用：${line}`);
		assert.ok(!/panels\.push|panels\.set\(/.test(line), `不应改动 panels 列表：${line}`);
		assert.ok(!/addEventListener|document\.|window\./.test(line), `不应全局 capture：${line}`);
		assert.ok(!/prototype|defineProperty|__proto__/.test(line), `不应 monkeypatch：${line}`);
	}
});

await test('B5 补丁声明 list/root 子槽并传入 wide 与 native className 合同', () => {
	const joined = addedLines.map((l) => l.slice(1)).join('\n');
	assert.ok(joined.includes(`"${SLOT_KEY}": {`), '必须声明 key');
	assert.match(joined, new RegExp(`"${SLOT_KEY.replaceAll('.', '\\.')}": \\{\\s*kind: "list",\\s*scope: "root"`));
	for (const cls of ['panelRow', 'panelActive', 'panelGlyph', 'panelTitle', 'wide']) {
		assert.ok(
			joined.includes(`SidebarRoot_module_css_default.${cls}`),
			`classes 合同缺少 ${cls}（原生视觉依赖它）`,
		);
	}
	assert.match(joined, /classes: \{/, '必须以 classes 对象下传 native className');
});

// ───────────────────────── C. 打补丁后的产物结构 ─────────────────────────

if (ensureFixtures(['sidebarPristine', 'sidebarPatched'])) {
	const patched = readFileSync(PATCHED, 'utf8');
	const pristine = readFileSync(PRISTINE, 'utf8');

	await test('C1 产物可被 node --check 解析', () => {
		const tmp = join(dirname(PATCHED), 'client.check.mjs');
		copyFileSync(PATCHED, tmp);
		try {
			execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
		} finally {
			rmSync(tmp, { force: true });
		}
	});

	await test('C2 插槽调用在 nav.panelList 的 children 数组内，位于原生行之后、More 菜单之前', () => {
		const navAt = patched.indexOf('className: SidebarRoot_module_css_default.panelList');
		assert.ok(navAt > 0, '必须存在 panelList nav');
		const outletAt = patched.indexOf(`renderSlot("${SLOT_KEY}"`);
		assert.ok(outletAt > navAt, '插槽必须在 panelList 之后（即在其 children 内）');
		const mapEnd = patched.lastIndexOf('}, id)), renderSlot(', outletAt + 1);
		assert.ok(mapEnd > navAt && mapEnd < outletAt, '插槽必须紧跟原生行 map 之后');
		const moreAt = patched.indexOf('(0, react_jsx_runtime.jsx)(PanelMoreMenu, {');
		assert.ok(outletAt < moreAt, '插槽必须在 More 菜单之前');
		const regionAt = patched.indexOf('className: SidebarRoot_module_css_default.regionArea');
		assert.ok(outletAt < regionAt, '插槽必须仍在 nav 内（早于 regionArea）');
	});

	await test('C3 产物只在 nav 内多了一处 renderSlot，其它原生渲染点数量不变', () => {
		const count = (s, key) => s.split(`renderSlot("${key}"`).length - 1;
		for (const key of ['sidebar.panellist', 'sidebar.workspaces', 'sidebar.settings', 'sidebar.footer.action']) {
			assert.equal(count(patched, key), count(pristine, key), `${key} 的渲染点数量不应改变`);
		}
		assert.equal(count(patched, SLOT_KEY), 1, '新槽只能有一个渲染点');
	});

	await test('C4 产物只多了一处 slot 声明，原生声明全部保留', () => {
		const decl = (s, key) => s.split(`"${key}": {`).length - 1;
		for (const key of ['sidebar.brand.mark', 'sidebar.brand.name', 'sidebar.toggle.badge',
			'sidebar.panellist', 'sidebar.panellist.actions', 'sidebar.workspaces',
			'sidebar.settings', 'sidebar.footer.action']) {
			assert.equal(decl(patched, key), decl(pristine, key), `${key} 声明不应改变`);
		}
		assert.equal(decl(patched, SLOT_KEY), 1);
	});

	await test('C5 PanelRow 硬编码行为未被改动（仍走 selectPanel，glyph 仍 aria-hidden）', () => {
		const grab = (s, from, len) => s.slice(s.indexOf(from), s.indexOf(from) + len);
		const a = grab(patched, 'function PanelRow(', 1200);
		const b = grab(pristine, 'function PanelRow(', 1200);
		assert.equal(a, b, 'PanelRow 必须逐字未变');
	});
} else {
	skip('C1-C5 产物结构', '缺少 patched fixture（已 --allow-skip）');
}

// ─────────────────────────────────── 汇总 ───────────────────────────────────

console.log('');
if (skipped.length > 0) console.log(`跳过 ${skipped.length} 项：\n  ${skipped.join('\n  ')}`);
if (failures.length > 0) {
	console.log(`\n${failures.length} 项失败 / ${passed} 项通过`);
	process.exitCode = 1;
} else {
	console.log(`全部通过：${passed} 项${skipped.length ? `（另有 ${skipped.length} 项跳过）` : ''}`);
}
