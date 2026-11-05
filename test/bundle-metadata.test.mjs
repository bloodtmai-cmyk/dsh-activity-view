#!/usr/bin/env node
/**
 * bundle 发布元数据 / 组合契约测试（不渲染 UI，不连宿主）。
 *
 * 覆盖三处必须一致的标识（#0008）与组合补丁的形态约束：
 *  1. package.json name == client.js factory id == cordis.patch.yml 里 activity-view row name；
 *  2. engines.dsh 是**运行时版本**（@deepseek-ai/dsh-app-boot 的版本，当前 0.2.2-rc.1），
 *     不是 Desktop 壳版本 2.0.22-next；
 *  3. 组合补丁按真实 row id 关原生两行，且 disabled 是行内唯一改动（删除本 bundle 即回原生）；
 *  4. 相对路径 row name 必须指向**文件**：`anchorInsertedPluginNames` 把 `./x` 变成目录的
 *     file URL，而真实 import 走 Node ESM，目录 URL 会 ERR_UNSUPPORTED_DIR_IMPORT；
 *  5. 候选生成助手只改发布标识，且源码仓库的包名不变。
 *
 * 运行：node --test test/bundle-metadata.test.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run as makeCandidate } from '../tools/make-linked-candidate.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));
const CLIENT = readFileSync(join(REPO, 'client.js'), 'utf8');
const PATCH = readFileSync(join(REPO, 'cordis.patch.yml'), 'utf8');

/** 补丁里 insert 的 row（只取 `name:` 行，够用且不做 YAML 解析）。 */
const rowNames = [...PATCH.matchAll(/^\s+name:\s*(\S+)\s*$/gm)].map((match) => match[1]);

test('包名与 client factory id 一致（#0008）', () => {
	assert.equal(PKG.name, 'dsh-activity-view');

	const loads = [...CLIENT.matchAll(/window\.__ModuleLoader__\.load\(/g)];
	assert.equal(loads.length, 1, '一个 client asset 只应有一次 __ModuleLoader__.load');

	const id = CLIENT.match(/\bid:\s*'([^']+)'/);
	assert.ok(id, 'client.js 必须显式声明 factory id');
	assert.equal(id[1], PKG.name, 'factory id 必须等于包名，否则运行侧的 asset 归属对不上');
	assert.equal(CLIENT.includes('@local/'), false, '源码里不应残留 @local 命名空间');
});

test('bundle patch row name 与包名一致', () => {
	assert.ok(PKG.dsh?.bundle?.patch === './cordis.patch.yml');
	assert.ok(rowNames.includes(PKG.name), 'activity-view row 必须用包名');
});

test('engines.dsh 用运行时版本，不是 Desktop 壳版本', () => {
	assert.equal(PKG.engines?.dsh, '0.2.2-rc.1');
	assert.notEqual(PKG.engines.dsh, '2.0.22-next', '2.0.22-next 是 Desktop 壳版本，不是 DSH 运行时版本');
	assert.ok(PKG.files.includes('compat'), 'compat 资源必须随包发布，否则删包无法整体还原');
});

test('随包 files 自带 compat 重建所需的 patches（#0009）', () => {
	// compat/lib/build.mjs 以自身所在包的根为 REPO（dirname(build.mjs)/../..），
	// 再按 vendor-lock 里的相对路径读 patches/*.patch；这些路径必须由本包 files 一起发布，
	// 否则从候选副本里执行 check/make 会 ENOENT（只能回源码目录找，违反自包含）。
	assert.ok(PKG.files.includes('patches'), 'patches 必须随包发布：compat/lib/build.mjs 依赖它重建 compat 产物');
	const lock = JSON.parse(readFileSync(join(REPO, 'compat/vendor-lock.json'), 'utf8'));
	const specs = Object.values(lock.packages ?? {});
	assert.ok(specs.length >= 2, 'vendor-lock 至少要锁住两个 compat 目标');
	for (const spec of specs) {
		assert.match(spec.patch, /^patches\//, `${spec.target} 的补丁必须位于 patches/ 下`);
		const top = spec.patch.split('/')[0];
		assert.ok(PKG.files.includes(top), `${spec.patch} 的顶层目录 ${top} 必须在 files 里，否则候选副本缺文件`);
		assert.ok(existsSync(join(REPO, spec.patch)), `${spec.patch} 必须存在`);
	}
});

test('组合补丁按真实 row id 关原生两行，且只改 disabled', () => {
	for (const id of ['ui-sidebar', 'ui-workspace']) {
		const block = PATCH.match(new RegExp(`- id: ${id}\\n\\s+disabled: true`));
		assert.ok(block, `${id} 必须按 id 精确关闭`);
	}
	// 只关不换：不出现对原生行的 config 替换，删除本 bundle 后原生行自然恢复
	assert.equal(/- id: ui-sidebar\n\s+config:/.test(PATCH), false);
	assert.equal(/- id: ui-workspace\n\s+config:/.test(PATCH), false);
});

test('相对路径 row name 指向真实文件，不是目录', (t) => {
	const relative = rowNames.filter((name) => name.startsWith('./') || name.startsWith('../'));
	assert.equal(relative.length, 2, '两个 compat row 都用相对路径');
	const generated = existsSync(join(REPO, 'compat/ui-workspace/package.json')) && existsSync(join(REPO, 'compat/ui-sidebar/package.json'));
	if (!generated) t.diagnostic('compat 包尚未落地（由宿主 actor 负责）：只校验 row 形态，不校验文件存在');
	for (const name of relative) {
		assert.match(name, /\.js$/, `${name} 必须给到入口文件，目录 URL 在 Node ESM 下不可导入`);
		const target = resolve(REPO, name);
		if (!generated) continue;
		assert.ok(existsSync(target), `${name} 指向的文件必须存在`);
		assert.equal(statSync(target).isFile(), true, `${name} 必须是文件（目录 URL 在 Node ESM 下不可导入）`);
		// 文件上方必须有 compat 包自己的 package.json，否则 manifest 会落到 root 上，engines/compat 判断失真
		let dir = dirname(target);
		let found = false;
		while (dir.startsWith(REPO)) {
			if (existsSync(join(dir, 'package.json'))) {
				found = dir !== REPO;
				break;
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		assert.equal(found, true, `${name} 必须落在带自己 package.json 的 compat 包目录里`);
	}
});

test('候选助手只改发布标识，源码包名不变', () => {
	const result = makeCandidate({ localName: '@local/activity-view', dryRun: true });
	assert.equal(result.code, 0, result.messages.join('\n'));
	assert.deepEqual(result.plan.map((item) => item.file).sort(), ['client.js', 'cordis.patch.yml', 'package.json']);
	assert.deepEqual(
		result.plan.map((item) => item.to.trim()).sort(),
		['"name": "@local/activity-view"', "id: '@local/activity-view',", 'name: "@local/activity-view"'].sort(),
		'三处标识必须一起改，且都改成同一个 linked 包名（YAML 那份必须加引号，#0011）',
	);
	assert.equal(PKG.name, 'dsh-activity-view', '源码仓库包名保持发布形态');
});
