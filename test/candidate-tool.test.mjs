#!/usr/bin/env node
/**
 * 候选生成助手的负向测试（#0010）。
 *
 * 约束来源：主审裁定——`--force` 按计算出的 dest 直接 rmSync 属于危险删除（未校验归属/
 * 符号链接/版本），`--keep-package-name` 会故意产出「包名 ≠ factory id」的不一致产物。
 * 现在的规则是：**不删除任何目录**，候选目录名带内容指纹（源码变 ⇒ 新目录），
 * 并在写入前做归属/边界/版本校验。
 *
 * 因此这里断言的是「拒绝与不破坏」：
 *  1. 已移除的选项不再被接受（rc=2）；
 *  2. 非法/同名包名被拒（rc=2 / rc=4），版本不安全时拒绝生成（isSafeVersion）；
 *  3. 同一源码两次 dry-run 得到同一候选路径（可复现），且路径在 .stage-candidate/ 下、含版本；
 *  4. 真跑一次后再跑：得到 rc=5，且既有候选**逐字节未被改动**（没有删除/覆盖）；
 *  5. 源码里不存在任何删除型文件 API 调用。
 *
 * 运行：node --test test/candidate-tool.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isSafeVersion, run as makeCandidate, STAGE_DIR } from '../tools/make-linked-candidate.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(REPO, 'tools/make-linked-candidate.mjs');
const TOOL_SOURCE = readFileSync(TOOL, 'utf8');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** 直接跑 CLI，拿真实退出码（不经过 run()，才不会漏掉参数解析的错误）。 */
function cli(args) {
	return spawnSync(process.execPath, [TOOL, ...args], { cwd: REPO, encoding: 'utf8' });
}

test('已移除的选项不再被接受（--force / --keep-package-name）', (t) => {
	for (const args of [['--force'], ['--keep-package-name'], ['--local-name', '@local/x', '--force']]) {
		const result = cli([...args, '--dry-run']);
		assert.equal(result.status, 2, `${args.join(' ')} 必须作为未知参数被拒绝`);
		assert.match(result.stderr, /未知参数/);
	}
	// 文本里可以提到这两个词（说明为何移除），但不能再有对应的参数解析分支
	assert.equal(/arg === '--force'/.test(TOOL_SOURCE), false, '不能保留 --force 解析');
	assert.equal(/keepPackageName/.test(TOOL_SOURCE), false, '不能保留 --keep-package-name 的实现（三处标识必须一起改）');
	t.diagnostic('已确认两个选项只作为历史说明文字存在，不再可被解析');
});

test('非法包名与同名包名被拒', () => {
	assert.equal(makeCandidate({ localName: 'Not A Package!', dryRun: true }).code, 2);
	assert.equal(makeCandidate({ localName: 'UPPER/Case', dryRun: true }).code, 2);
	assert.equal(makeCandidate({ localName: 'dsh-activity-view', dryRun: true }).code, 4, '与发布名相同则无需候选');
});

test('版本号必须可安全用于路径', () => {
	for (const ok of ['1.0.1', '1.0.1-rc.1', '0.2.2-rc.1']) assert.equal(isSafeVersion(ok), true, ok);
	for (const bad of ['1.0', 'v1.0.1', '../evil', '1.0.1/../x', '', '1.0.1\n']) assert.equal(isSafeVersion(bad), false, JSON.stringify(bad));
	assert.equal(TOOL_SOURCE.includes('rmSync'), false, '不能引入删除型 API');
});

test('候选路径可复现、位于 .stage-candidate/ 且带版本号', () => {
	const first = makeCandidate({ localName: '@local/activity-view', dryRun: true });
	const second = makeCandidate({ localName: '@local/activity-view', dryRun: true });
	assert.equal(first.code, 0, first.messages.join('\n'));
	assert.equal(first.dest, second.dest, '同一源码必须得到同一候选路径（内容指纹）');
	const rel = relative(join(REPO, STAGE_DIR), first.dest);
	assert.equal(rel.startsWith('..'), false, '候选必须落在 .stage-candidate/ 内');
	assert.match(rel, /^dsh-activity-view-1\.0\.1-[0-9a-f]{12}-linked$/);
});

test('目标是符号链接时拒绝写入', (t) => {
	const probe = makeCandidate({ localName: '@local/activity-view', dryRun: true });
	if (existsSync(probe.dest)) {
		t.diagnostic('同内容候选已存在（正常交付状态），符号链接分支无法在不删除既有目录的前提下构造，跳过');
		return;
	}
	// 只在目标缺失时构造一个指到仓库外的符号链接，验证拒绝后自行清理（清理的是本测试自己创建的链接）
	symlinkSync('/tmp', probe.dest);
	try {
		const result = makeCandidate({ localName: '@local/activity-view' });
		assert.equal(result.code, 6, '指向仓库外的符号链接必须被拒绝');
		assert.match(result.messages.join('\n'), /符号链接/);
		assert.equal(lstatSync(probe.dest).isSymbolicLink(), true, '拒绝时不得动那个符号链接');
	} finally {
		unlinkSync(probe.dest);
	}
});

test('重复生成不删除、不覆盖已有候选（#0010 核心）', () => {
	const first = makeCandidate({ localName: '@local/activity-view' });
	assert.ok(first.code === 0 || first.code === 5, first.messages.join('\n'));
	const manifest = join(first.dest, 'candidate.json');
	assert.ok(existsSync(manifest), '候选目录里必须有 candidate.json');
	const before = sha256(readFileSync(manifest));
	const listingBefore = readFileSync(join(first.dest, 'client.js'));

	const second = makeCandidate({ localName: '@local/activity-view' });
	assert.equal(second.code, 5, '已存在同内容候选时必须拒绝重建');
	assert.match(second.messages.join('\n'), /未覆盖、未删除/);
	assert.equal(existsSync(first.dest), true, '候选目录必须仍然存在');
	assert.equal(sha256(readFileSync(manifest)), before, 'candidate.json 不能被改写');
	assert.equal(sha256(readFileSync(join(first.dest, 'client.js'))), sha256(listingBefore), 'client.js 不能被改写');
});
