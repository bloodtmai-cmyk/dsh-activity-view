/**
 * 真实 YAML 解析回归（#0011）。
 *
 * 背景：`@` 是 YAML 的保留指示符，`name: @local/activity-view` 这种 plain scalar
 * 会让解析器直接报 `found character that cannot start any token`。profile 装配时
 * cordis.patch.yml 解析失败 = 整个 profile 起不来，因此这里**用真实解析器**
 * （系统自带 ruby + Psych，不装任何依赖、不手写解析器）对所有会进到磁盘的
 * patch 做硬断言：
 *
 *   1. 仓库发布用 patch（name 不带 @）
 *   2. 候选改写产物（name 带 @，必须被转义成双引号标量）
 *   3. 实际 linked 目标 patch（真实运行的那一份）
 *   4. 历史未加引号的样本必须解析失败（证明这类文件确实是无效 YAML）
 *
 * 除了解析成功，还断言语义没被引号改动带偏：三条 insert 的 name 与两行 disabled
 * 必须逐一相等。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import { REWRITES, fingerprint, run as makeCandidate } from '../tools/make-linked-candidate.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const RUBY = '/usr/bin/ruby';
const HAS_PSYCH = spawnSync(RUBY, ['-ryaml', '-e', 'require "psych"'], { encoding: 'utf8' }).status === 0;
const SKIP = HAS_PSYCH ? false : '系统 ruby/Psych 不可用';
const LOCAL_NAME = '@local/activity-view';

/** 实际运行的那一份（本机 linked 安装副本）；不在本机时该用例跳过。 */
const TARGET_PATCH = join(REPO, '..', 'activity-view', 'cordis.patch.yml');
/** 历史候选（未加引号，已被新候选取代，保留不删）——用它证明这类文件确实无效。 */
const LEGACY_UNQUOTED = join(
	REPO,
	'.stage-candidate',
	'dsh-activity-view-1.0.1-df9f9e2dd147-linked',
	'cordis.patch.yml',
);

const EXPECTED_INSERT_NAMES = [
	'./compat/ui-workspace/lib/index.js',
	'./compat/ui-sidebar/lib/index.js',
	'dsh-activity-view',
];
const EXPECTED_DISABLED = [
	{ id: 'ui-sidebar', disabled: true },
	{ id: 'ui-workspace', disabled: true },
];

/** 用真实解析器把 YAML 文本变成 JS 对象；失败时原样带回 stderr。 */
function parseYaml(text) {
	const dir = mkdtempSync(join(tmpdir(), 'dsh-yaml-'));
	const file = join(dir, 'patch.yml');
	try {
		writeFileSync(file, text);
		const out = spawnSync(
			RUBY,
			['-ryaml', '-rjson', '-e', 'print JSON.generate(YAML.load_file(ARGV[0]))', file],
			{ encoding: 'utf8' },
		);
		return {
			status: out.status,
			stderr: out.stderr ?? '',
			doc: out.status === 0 ? JSON.parse(out.stdout) : null,
		};
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** 从解析结果里取出本 bundle patch 关心的两件事：insert 行 name、disabled 行。 */
function outline(doc) {
	const rows = Array.isArray(doc) ? doc : [];
	const insertNames = rows
		.filter((row) => row !== null && typeof row === 'object' && Object.hasOwn(row, 'insert'))
		.flatMap((row) => row.insert)
		.map((row) => row.name);
	const disabled = rows
		.filter((row) => row !== null && typeof row === 'object' && Object.hasOwn(row, 'disabled'))
		.map((row) => ({ id: row.id, disabled: row.disabled }));
	return { insertNames, disabled };
}

/** 按候选助手的同一套 REWRITES 在内存里生成候选 patch 文本（不落盘、不走第二套实现）。 */
function candidatePatchText(localName) {
	const rule = REWRITES.find((item) => item.file === 'cordis.patch.yml');
	const source = readFileSync(join(REPO, 'cordis.patch.yml'), 'utf8');
	const hits = source.split(rule.from).length - 1;
	assert.equal(hits, 1, '改写点必须唯一命中，否则候选助手会拒绝生成');
	return source.replace(rule.from, rule.to(localName));
}

test('仓库发布 patch 能被真实 YAML 解析，且三行 insert / 两行 disabled 语义正确', { skip: SKIP }, () => {
	const text = readFileSync(join(REPO, 'cordis.patch.yml'), 'utf8');
	assert.equal(/\bname:\s*@/.test(text), false, '发布 patch 里不允许出现未加引号的 @ 起始 plain scalar');

	const { status, stderr, doc } = parseYaml(text);
	assert.equal(status, 0, `发布 patch 解析失败：${stderr}`);
	const { insertNames, disabled } = outline(doc);
	assert.deepEqual(insertNames, EXPECTED_INSERT_NAMES);
	assert.deepEqual(disabled, EXPECTED_DISABLED);
});

test('候选改写产物能被真实 YAML 解析：@ 起始的 name 必须被引号包住', { skip: SKIP }, () => {
	const text = candidatePatchText(LOCAL_NAME);
	assert.match(text, /name: "@local\/activity-view"/, '改写必须输出双引号标量');

	const { status, stderr, doc } = parseYaml(text);
	assert.equal(status, 0, `候选 patch 解析失败：${stderr}`);
	const { insertNames, disabled } = outline(doc);
	assert.deepEqual(insertNames, [
		'./compat/ui-workspace/lib/index.js',
		'./compat/ui-sidebar/lib/index.js',
		LOCAL_NAME,
	]);
	assert.deepEqual(disabled, EXPECTED_DISABLED);
});

test('已生成候选目录里的 patch 同样能被真实解析', { skip: SKIP }, () => {
	const dry = makeCandidate({ localName: LOCAL_NAME, dryRun: true });
	assert.equal(dry.code, 0, dry.messages.join('\n'));
	const file = join(dry.dest, 'cordis.patch.yml');
	if (!existsSync(file)) return; // 还没生成候选：由上面「改写产物」用例覆盖
	const { status, stderr, doc } = parseYaml(readFileSync(file, 'utf8'));
	assert.equal(status, 0, `${dry.dest}/cordis.patch.yml 解析失败：${stderr}`);
	assert.deepEqual(outline(doc).insertNames.at(-1), LOCAL_NAME);
});

test('实际 linked 目标 patch 能被真实解析（不存在则跳过）', { skip: SKIP || (existsSync(TARGET_PATCH) ? false : '本机无 linked 目标') }, () => {
	const text = readFileSync(TARGET_PATCH, 'utf8');
	assert.equal(/\bname:\s*@/.test(text), false, '实际目标里不允许出现未加引号的 @ 起始 plain scalar');

	const { status, stderr, doc } = parseYaml(text);
	assert.equal(status, 0, `实际目标解析失败：${stderr}`);
	const { insertNames, disabled } = outline(doc);
	assert.deepEqual(insertNames, [
		'./compat/ui-workspace/lib/index.js',
		'./compat/ui-sidebar/lib/index.js',
		LOCAL_NAME,
	]);
	assert.deepEqual(disabled, EXPECTED_DISABLED);
});

test('历史未加引号的样本确实解析失败（不存在则跳过）', { skip: SKIP || (existsSync(LEGACY_UNQUOTED) ? false : '历史候选已不在本机') }, () => {
	const { status, stderr } = parseYaml(readFileSync(LEGACY_UNQUOTED, 'utf8'));
	assert.notEqual(status, 0, '未加引号的 name: @... 不应该被任何真实解析器接受');
	assert.match(stderr, /cannot start any token/);
});

test('候选指纹包含改写结果：改写算法一变就换新目录，不会复用旧候选', () => {
	const meta = { name: 'dsh-activity-view', version: '1.0.1', localName: LOCAL_NAME };
	const entries = ['package.json'];
	const plan = REWRITES.map((rule) => ({ file: rule.file, from: rule.from, to: rule.to(LOCAL_NAME) }));

	assert.notEqual(
		fingerprint(entries, meta, plan),
		fingerprint(entries, meta, []),
		'指纹必须随改写结果变化，否则修好 quote 后仍会命中旧目录',
	);
	assert.notEqual(
		fingerprint(entries, meta, plan),
		fingerprint(entries, meta, plan.map((item) => ({ ...item, to: item.to.replace(/"/g, '') }))),
		'引号这类字节级变化也必须改变指纹',
	);

	const dry = makeCandidate({ localName: LOCAL_NAME, dryRun: true });
	assert.equal(dry.code, 0, dry.messages.join('\n'));
	assert.match(dry.dest, /-linked$/);
	assert.notEqual(dry.dest.split('-').at(-2), 'df9f9e2dd147', '不能复用 #0011 之前的旧指纹目录');
});
