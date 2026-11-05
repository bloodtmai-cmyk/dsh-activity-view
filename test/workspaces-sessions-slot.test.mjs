#!/usr/bin/env node
/**
 * 宿主补丁 0001 的真实逻辑测试。
 *
 * 两类断言：
 *  A. 用**真实的** `SlotCore`（暂存副本 .stage-hostpatch/stage/ui-slots/lib/index.js，来自 app.asar）
 *     验证本补丁依赖的注册表语义：声明来源、single 冲突、priority 遮蔽、dispose 后回落、
 *     订阅通知（SlotOutlet 的 useSyncExternalStore 依赖它）。
 *  B. 对 `patches/0001-sidebar-workspaces-sessions-slot.patch` 与打过补丁的构建产物做形态断言，
 *     覆盖"只换列表体、原生头部/搜索/视图/兜底全部保留"。
 *
 * 不测试 React 渲染：这里没有 React/DOM 运行时，也不做假 DOM。
 * 运行：node test/workspaces-sessions-slot.test.mjs
 * fixture 由 test/helpers/prepare-host-fixtures.mjs 生成；缺失时默认 fail（exit 1），
 * 只有显式 --allow-skip 才降级跳过（补丁文本断言始终执行）。
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { FIXTURES, ensureFixtures } from './helpers/fixtures.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SLOTS = FIXTURES.slots;
const PATCH = join(REPO, 'patches/0001-sidebar-workspaces-sessions-slot.patch');
const PRISTINE = FIXTURES.workspacePristine;
const PATCHED = FIXTURES.workspacePatched;

const SLOT_KEY = 'sidebar.workspaces.sessions';
const failures = [];
let passed = 0;
const skipped = [];

async function test(name, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`ok   ${name}`);
	} catch (error) {
		failures.push([name, error]);
		console.log(`FAIL ${name}\n     ${error.message.split('\n').join('\n     ')}`);
	}
}

function skip(name, why) {
	skipped.push(`${name} — ${why}`);
	console.log(`skip ${name} (${why})`);
}

const patchText = readFileSync(PATCH, 'utf8');
const patchLines = patchText.split('\n');
const added = patchLines.filter((line) => line.startsWith('+') && !line.startsWith('+++'));
const removed = patchLines.filter((line) => line.startsWith('-') && !line.startsWith('---'));
/** 去掉 diff 前缀后的净新增/删除内容（用于结构断言，前缀会干扰缩进匹配）。 */
const addedText = added.map((line) => line.slice(1)).join('\n');
const removedText = removed.map((line) => line.slice(1)).join('\n');

// ─────────────────────────────── A. 真实 SlotCore 语义 ───────────────────────────────

let SlotCore;
if (ensureFixtures(['slots'])) {
	({ SlotCore } = await import(pathToFileURL(SLOTS).href));
} else {
	skip('A. SlotCore 语义', '缺少 slot fixture（已 --allow-skip）；准备：node test/helpers/prepare-host-fixtures.mjs');
}

/** 复刻 ui-workspace 入口的声明形状：父 entry 在 children 表里声明本补丁新增的 key。 */
function makeHost(core, { declareSessions = true } = {}) {
	const children = {
		'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
		'sidebar.session.row.hover': { kind: 'list', scope: 'root' },
	};
	if (declareSessions) children[SLOT_KEY] = { kind: 'single', scope: 'root' };
	const disposeParent = core.register(
		{ name: 'root', children, inject: {}, locale: 'ns' },
		function Parent() { return null; },
	);
	return disposeParent;
}

if (SlotCore) {
	await test('A1 未声明的 key 注册直接报错（子槽必须先由父 entry 声明）', () => {
		const core = new SlotCore();
		makeHost(core, { declareSessions: false });
		assert.throws(
			() => core.register({ name: SLOT_KEY }, () => null),
			/is not declared \(a parent entry's children table must declare it\)/,
		);
	});

	await test('A2 父 entry 声明后该槽存在但无 occupant（→ 原生 fallback 生效）', () => {
		const core = new SlotCore();
		makeHost(core);
		assert.deepEqual(core.spec(SLOT_KEY), { kind: 'single', scope: 'root' });
		assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, '空槽必须投影为 0 个 winner');
		assert.equal(core.entries(SLOT_KEY).length, 0);
	});

	await test('A3 同 priority(0) 第二人注册 = 抛错，不是静默覆盖', () => {
		const core = new SlotCore();
		makeHost(core);
		core.register({ name: SLOT_KEY }, function A() { return null; });
		assert.throws(
			() => core.register({ name: SLOT_KEY }, function B() { return null; }),
			/already has a registration at priority 0.*register at a different priority to shadow it \(lowest renders\)/,
		);
		assert.equal(core.entriesOfSlot(SLOT_KEY).length, 1, '冲突不落账：仍只有 1 个 winner');
	});

	await test('A4 不同 priority 合法并被更低数值遮蔽（遮蔽者优先渲染）', () => {
		const core = new SlotCore();
		makeHost(core);
		core.register({ name: SLOT_KEY }, function Base() { return null; });
		core.register({ name: SLOT_KEY, priority: -1 }, function Override() { return null; });
		const winners = core.entriesOfSlot(SLOT_KEY);
		assert.equal(winners.length, 1, 'single 只有一个 cell');
		assert.equal(winners[0].options.priority, -1, 'lowest renders');
		assert.equal(core.entries(SLOT_KEY).length, 2, '原始账本保留两人以备遮蔽者释放');
	});

	await test('A5 dispose 后回落：winner 回到下层，全释放后回到空槽（renderer 走 fallback 分支）', () => {
		const core = new SlotCore();
		makeHost(core);
		const offBase = core.register({ name: SLOT_KEY }, function Base() { return null; });
		const offOverride = core.register({ name: SLOT_KEY, priority: -1 }, function Override() { return null; });
		assert.equal(core.entriesOfSlot(SLOT_KEY)[0].options.priority, -1);
		offOverride();
		assert.equal(core.entriesOfSlot(SLOT_KEY)[0].options.priority, undefined, '撤回覆盖后由 priority 0 的 entry 接替');
		offBase();
		assert.equal(core.entriesOfSlot(SLOT_KEY).length, 0, '无人占据 → SlotOutlet 渲染 opts.fallback（原生列表）');
		assert.equal(core.isLive(core.entries(SLOT_KEY)[0]), false);
	});

	await test('A6 注册/释放都会通知订阅者（renderer 的 SlotOutlet 据此重渲染，无需 apply 期探测）', async () => {
		const core = new SlotCore();
		makeHost(core);
		let notified = 0;
		const off = core.subscribe(SLOT_KEY, () => { notified += 1; });
		const before = core.getVersion(SLOT_KEY);
		const offEntry = core.register({ name: SLOT_KEY }, function Override() { return null; });
		await Promise.resolve();
		await Promise.resolve();
		assert.ok(notified >= 1, '注册必须触发通知');
		assert.notEqual(core.getVersion(SLOT_KEY), before, '注册必须 bump version（uSES 的 getSnapshot）');
		const midVersion = core.getVersion(SLOT_KEY);
		offEntry();
		await Promise.resolve();
		await Promise.resolve();
		assert.ok(notified >= 2, '释放必须触发通知');
		assert.notEqual(core.getVersion(SLOT_KEY), midVersion, '释放必须 bump version');
		off();
	});

	await test('A7 同一 key 二次声明被拒绝（避免两个父 entry 抢声明）', () => {
		const core = new SlotCore();
		core.register({ name: 'root', children: { branch: { kind: 'single', scope: 'root' } } }, () => null);
		core.register({ name: 'branch', children: { [SLOT_KEY]: { kind: 'single', scope: 'root' } } }, () => null);
		assert.throws(
			() => core.register({ name: 'branch', priority: -1, children: { [SLOT_KEY]: { kind: 'single', scope: 'root' } } }, () => null),
			/is already declared \(by an entry in "branch"\)/,
		);
	});

	await test('A9 复刻 renderer SlotOutlet 的 single 分支：occupant ↔ fallback 随注册/释放切换', async () => {
		// 直接搬 dsh-client-ui-renderer/lib/client.js L1173-1177 的单占位决策：
		//   const entries = host.entries(key);
		//   const entry = host.entriesOfSlot(key)[0];
		//   if (!entry) return entries.length > 0 ? deadCell() : <>{opts?.fallback}</>;
		const NATIVE = 'NATIVE_FALLBACK';
		const slotOutletSingle = (host, slotKey) => {
			const entries = host.entries(slotKey);
			const entry = host.entriesOfSlot(slotKey)[0];
			if (!entry) return entries.length > 0 ? 'DEAD' : NATIVE;
			return entry.component;
		};
		const core = new SlotCore();
		makeHost(core);
		assert.equal(slotOutletSingle(core, SLOT_KEY), NATIVE, '无 occupant 时必须渲染原生 fallback（= 未打补丁行为）');

		const override = function OverrideList() { return null; };
		const off = core.register({ name: SLOT_KEY }, override);
		assert.equal(slotOutletSingle(core, SLOT_KEY), override, '注册后 outlet 改渲染占位者');

		// 订阅驱动的重渲染次数 = uSES 的实际行为（SlotOutlet 用 subscribe+getVersion）
		let renders = 0;
		const offSub = core.subscribe(SLOT_KEY, () => { renders += 1; });
		const off2 = core.register({ name: SLOT_KEY, priority: -1 }, function Shadow() { return null; });
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(slotOutletSingle(core, SLOT_KEY).name, 'Shadow');
		assert.ok(renders >= 1, '遮蔽注册会通知 outlet 重渲染');
		off2();
		off();
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(slotOutletSingle(core, SLOT_KEY), NATIVE, '全部释放后自动回到原生 fallback');
		offSub();
		// 空 outlet 不能当作"有占位者"：这正是不允许用 renderSlot()!==null 探测的原因
		assert.notEqual(slotOutletSingle(core, SLOT_KEY), 'DEAD');
	});

	await test('A8 声明 kind 决定注册契约：list 需要 id，single 不需要', () => {
		const core = new SlotCore();
		core.register({
			name: 'root',
			children: {
				'x.list': { kind: 'list', scope: 'root' },
				[SLOT_KEY]: { kind: 'single', scope: 'root' },
			},
		}, () => null);
		assert.throws(() => core.register({ name: 'x.list' }, () => null), /list slot "x\.list" requires options\.id/);
		assert.doesNotThrow(() => core.register({ name: SLOT_KEY }, () => null));
	});
}

// ─────────────────────────── B. 补丁形态（补丁文本 + 构建产物） ───────────────────────────

await test('B1 补丁只改 lib/client.js，且只有 4 个 hunk', () => {
	const files = [...new Set(
		patchLines
			.filter((line) => line.startsWith('--- ') || line.startsWith('+++ '))
			.map((line) => line.slice(4).split('\t')[0]),
	)];
	assert.deepEqual(files, ['a/lib/client.js', 'b/lib/client.js']);
	assert.equal(patchLines.filter((line) => line.startsWith('@@')).length, 4);
});

await test('B2 最小性：全补丁只删 1 行（搜索分支的 else 分支入口），其余为纯新增', () => {
	// `}))` 是上下文行：尾部多出的括号由新增行 + 原上下文共同闭合，说明补丁没有改动原生括号结构。
	assert.equal(removed.length, 1, `实际删除行：\n${removedText}`);
	assert.equal(removedText.trim(), '}) : groupBy === "flat" ? (0, react_jsx_runtime.jsx)(FlatList, {');
	assert.ok(addedText.includes('\t\t\t\t\t\t\thookContext: sessionsSlotOwner'), 'hookContext 为新增行');
	assert.ok(patchLines.some((line) => line === ' \t\t\t\t\t\t}))'), 'SessionTree 的尾括号必须仍是上下文行（未被改写）');
});

await test('B3 子槽声明进 sidebar.workspaces 的 children 表，kind=single scope=root', () => {
	assert.match(
		addedText,
		new RegExp(`"${SLOT_KEY.replace(/\./g, '\\.')}": \\{\\s*kind: "single",\\s*scope: "root"`),
	);
	// 定位：必须紧邻既有兄弟槽声明，说明落在 children 表内而不是别处
	const at = patchText.indexOf(`"${SLOT_KEY}": {`);
	assert.ok(at > 0);
	const beforeSibling = patchText.lastIndexOf('"sidebar.session.row.hover"', at);
	assert.ok(beforeSibling > 0 && at - beforeSibling < 200, '新声明应紧邻既有兄弟槽声明');
});

await test('B4 挂载点：非搜索分支变成 renderSlot(..., { fallback, hookContext })，搜索分支原样保留', () => {
	const text = added.join('\n');
	assert.ok(text.includes(`renderSlot("${SLOT_KEY}", sessionsSlotOwner, {`), '必须以 renderSlot 挂载并传入 owner');
	assert.ok(text.includes('fallback: groupBy === "flat" ? (0, react_jsx_runtime.jsx)(FlatList, {'), '原生 FlatList 作为 fallback');
	assert.ok(text.includes('hookContext: sessionsSlotOwner'), '同一 owner 作为 hookContext');
	// 搜索路径没有被改写：只出现在上下文行（空格前缀），不在 + / - 行
	assert.ok(!removed.some((line) => line.includes('SearchResults')), '搜索分支不得被删改');
	assert.ok(!added.some((line) => line.trim().startsWith('children: wide && (')), 'wide 守卫不得被展平');
});

await test('B5 owner 合同字段齐全（view/sessions/actions/row 四组，逐项核对）', () => {
	const text = added.join('\n');
	for (const field of [
		'groupBy', 'orderBy', 'archivedFilter', 'wide', 'ready: list.phase === "ready"',
		'list,', 'workspaces: orderedWorkspaces', 'ungroupedSessionIds: orderedUngroupedSessionIds',
		'flatSessionIds: orderedFlatSessionIds', 'currentSessionId: currentBlank',
		'archivedSessionIds', 'pinnedSessionIds', 'home',
		'openSession: guardedOpen', 'openSessionMenu', 'startSession',
		'setArchivedFilter: actions.setArchivedFilter', 'setGroupBy: actions.setGroupBy',
		'actions: (sessionId) => renderSlot("sidebar.workspaces.session.row.action", { sessionId })',
		'leading: (sessionId) => renderSlot("sidebar.session.row.leading", { sessionId })',
		'trailing: (sessionId) => renderSlot("sidebar.session.row.trailing", { sessionId })',
		'hover: (sessionId) => renderSlot("sidebar.session.row.hover", { sessionId })',
	]) {
		assert.ok(text.includes(field), `owner 合同缺字段：${field}`);
	}
	// 未取证的东西不许出现在合同里
	assert.ok(!text.includes('requestSessionRename'), '未取证的 requestSessionRename 不得进入合同');
});

if (ensureFixtures(['workspacePristine', 'workspacePatched'])) {
	const pristine = readFileSync(PRISTINE, 'utf8');
	const patched = readFileSync(PATCHED, 'utf8');

	await test('B6 原构建产物不含新槽（打补丁前后差异只来自本补丁）', () => {
		assert.ok(!pristine.includes(SLOT_KEY), '原始产物不应已含该 key');
		assert.equal(patched.length - pristine.length, 1201, '补丁净增字节数应稳定（版本锁定的旁证）');
	});

	await test('B7 打过补丁的产物：row 插槽与搜索路径仍全部在位', () => {
		assert.ok(patched.includes('"sidebar.session.row.leading"'));
		assert.ok(patched.includes('"sidebar.session.row.trailing"'));
		assert.ok(patched.includes('"sidebar.session.row.hover"'));
		assert.ok(patched.includes('"sidebar.workspaces.directoryFlow"'));
		assert.ok(patched.includes('"sidebar.workspaces.session.row.action"'));
		assert.ok(patched.includes('sanitizeSearchQuery(query).trim()'), '搜索仍走原生');
		assert.ok(patched.includes('openSessionMenu(node.id, row.title'), '行右键菜单仍是原生实现');
	});

	await test('B8 打过补丁的产物：原生兜底两支都还在（FlatList + SessionTree）', () => {
		const region = patched.slice(patched.indexOf(`renderSlot("${SLOT_KEY}"`), patched.indexOf(`renderSlot("${SLOT_KEY}"`) + 4000);
		assert.ok(region.includes('fallback: groupBy === "flat"'), 'flat 兜底');
		assert.ok(region.includes('(0, react_jsx_runtime.jsx)(FlatList, {'), 'FlatList 仍在');
		assert.ok(region.includes('(0, react_jsx_runtime.jsx)(SessionTree, {'), 'SessionTree 仍在');
		assert.ok(region.includes('hookContext: sessionsSlotOwner'));
	});

	await test('B9 打过补丁的产物：wide 守卫与搜索三元结构未被破坏', () => {
		const start = patched.indexOf('children: wide && (');
		assert.ok(start > 0, 'children: wide && ( 必须存在');
		const block = patched.slice(start, start + 3000);
		assert.ok(/children: wide && \(normalizedQuery !== "" \?/.test(block),
			'必须保持 wide && (normalizedQuery !== "" ? <SearchResults/> : renderSlot(...)) 的原有结构');
		assert.ok(block.includes(`renderSlot("${SLOT_KEY}", sessionsSlotOwner, {`));
	});
} else {
	skip('B6-B9 构建产物断言', '缺少 patched fixture（已 --allow-skip）');
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
