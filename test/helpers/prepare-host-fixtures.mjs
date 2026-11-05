#!/usr/bin/env node
/**
 * 可复现地准备两个宿主补丁的测试 fixture（issue #0004 ②）。
 *
 * 行为：
 *  1. **只读** app.asar（默认 `/Applications/DSH NEXT.app/Contents/Resources/app.asar`，
 *     可用 `--asar` 指定），按固定 sha256 与版本号校验后，把 3 个包文件原样写到仓库内
 *     `.stage-hostpatch/stage/…`（pristine fixture）。
 *  2. 复制 pristine → `.stage-hostpatch/fixtures/…`，**先 `patch --dry-run`**，只要 rc≠0 立即停止；
 *     dry-run 通过后才真打，并校验产物 sha256（patched fixture）。
 *  3. 对两处产物做 `node --check`（ESM，临时复制为 .mjs 后删除），最后写 `fixtures/manifest.json`。
 *
 * 安全边界：绝不写 `/Applications`、`~/.dsh` 或任何 app.asar；除本工作区 `.stage-hostpatch/` 外不落盘。
 *
 * 用法：
 *   node test/helpers/prepare-host-fixtures.mjs [--asar <path>] [--force]
 *
 * 退出码：
 *   0 成功（fixture 齐备）
 *   2 用法错误
 *   3 asar 不可读 / 缺少条目 / 条目是 unpacked
 *   4 版本或 sha256 与锁定值不一致（说明包已升级，需要重新生成补丁）
 *   5 patch dry-run 或 apply 失败
 *   6 `node --check` 失败
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, closeSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGE = join(REPO, '.stage-hostpatch');
const DEFAULT_ASAR = '/Applications/DSH NEXT.app/Contents/Resources/app.asar';

/** 锁定的三个包文件：asar 内路径、落盘路径、完整 sha256。 */
const LOCKED = [
	{
		key: 'ui-slots',
		pkg: 'dsh-client-ui-slots',
		version: '0.2.2-rc.1',
		inner: 'lib/index.js',
		out: join(STAGE, 'stage/ui-slots/lib/index.js'),
		sha256: '57e1314e31a2015f30231e1e7596da658f1bb5cb64c103c4cf13381647412c99',
	},
	{
		key: 'ui-workspace',
		pkg: 'dsh-client-ui-workspace',
		version: '0.2.2-rc.1',
		inner: 'lib/client.js',
		out: join(STAGE, 'stage/ui-workspace/lib/client.js'),
		sha256: '89b32d7916cb56dacb40d36d91fadbd627c1890fe84eb357a5ba9bfdd21c901b',
		patchedOut: join(STAGE, 'fixtures/ui-workspace/lib/client.js'),
		patchedSha256: 'fc8521e1394cb762ce581fb3375286e65bd02edcb807839af7260a59a6f78e0b',
		patch: join(REPO, 'patches/0001-sidebar-workspaces-sessions-slot.patch'),
	},
	{
		key: 'ui-sidebar',
		pkg: 'dsh-client-ui-sidebar',
		version: '0.2.2-rc.1',
		inner: 'lib/client.js',
		out: join(STAGE, 'stage/dsh-client-ui-sidebar/lib/client.js'),
		sha256: 'b6085dca1d2e1e48a3d4d8eaef609613af5201100552476c16119cd1ced136b1',
		patchedOut: join(STAGE, 'fixtures/ui-sidebar/lib/client.js'),
		patchedSha256: '6ba788f80d4f7d9467318a08263bf626db5f3c6fc95f9a7cf786344e8399a1d1',
		patch: join(REPO, 'patches/0002-sidebar-navigation-action-slot.patch'),
	},
];

function die(code, message) {
	console.error(`\n[prepare-host-fixtures] ${message}`);
	process.exit(code);
}

// ───────────────────────── 参数 ─────────────────────────

const argv = process.argv.slice(2);
let asarPath = DEFAULT_ASAR;
let force = false;
for (let i = 0; i < argv.length; i += 1) {
	const arg = argv[i];
	if (arg === '--asar') {
		asarPath = argv[i + 1];
		i += 1;
		if (!asarPath) die(2, '--asar 需要一个路径');
	} else if (arg === '--force') {
		force = true;
	} else if (arg === '-h' || arg === '--help') {
		console.log('usage: node test/helpers/prepare-host-fixtures.mjs [--asar <app.asar>] [--force]');
		process.exit(0);
	} else {
		die(2, `未知参数：${arg}`);
	}
}

if (!existsSync(asarPath)) die(3, `找不到 asar：${asarPath}`);

// ───────────────────────── 只读 asar ─────────────────────────

const archiveFd = openSync(asarPath, 'r');
const archiveBytes = fstatSync(archiveFd).size; // 只取已打开 fd 的 stat，不把整档读进内存

/** 读取 asar 头（不缓存文件内容，按条目按需 read）。 */
function readHeader() {
	const sizeBuf = Buffer.alloc(8);
	readSync(archiveFd, sizeBuf, 0, 8, 0);
	const headerSize = sizeBuf.readUInt32LE(4);
	const headerBuf = Buffer.alloc(headerSize);
	readSync(archiveFd, headerBuf, 0, headerSize, 8);
	const jsonLen = headerBuf.readUInt32LE(4);
	return {
		header: JSON.parse(headerBuf.subarray(8, 8 + jsonLen).toString('utf8')),
		baseOffset: 8 + headerSize,
	};
}

let headerInfo;
try {
	headerInfo = readHeader();
} catch (error) {
	die(3, `asar 头解析失败：${error.message}`);
}

function readEntry(innerPath) {
	let node = headerInfo.header;
	for (const part of innerPath.split('/').filter(Boolean)) {
		node = node?.files?.[part];
		if (!node) die(3, `asar 内缺少条目：${innerPath}（在 ${part} 处断开）`);
	}
	if (node.files) die(3, `asar 条目是目录：${innerPath}`);
	if (node.unpacked) die(3, `asar 条目是 unpacked，无法从主档读取：${innerPath}`);
	const size = Number(node.size);
	const offset = headerInfo.baseOffset + Number(node.offset);
	if (!Number.isFinite(size) || !Number.isFinite(offset) || offset + size > archiveBytes) {
		die(3, `asar 条目偏移非法：${innerPath}`);
	}
	const buf = Buffer.alloc(size);
	readSync(archiveFd, buf, 0, size, offset);
	return buf;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// 版本校验：只内存读取各包 package.json，不落盘。
for (const entry of LOCKED) {
	const pkgJson = JSON.parse(readEntry(`node_modules/@deepseek-ai/${entry.pkg}/package.json`).toString('utf8'));
	if (pkgJson.version !== entry.version) {
		die(
			4,
			`${entry.pkg} 版本不匹配：asar=${pkgJson.version}，锁定=${entry.version}。` +
				'说明已升级，需要重新生成补丁与 fixture 常量。',
		);
	}
}

// ───────────────────────── 写 pristine fixture ─────────────────────────

mkdirSync(STAGE, { recursive: true });
const manifest = {
	tool: 'test/helpers/prepare-host-fixtures.mjs',
	generatedAt: new Date().toISOString(),
	asar: asarPath,
	asarBytes: archiveBytes,
	files: {},
};

for (const entry of LOCKED) {
	const buf = readEntry(`node_modules/@deepseek-ai/${entry.pkg}/${entry.inner}`);
	const got = sha256(buf);
	if (got !== entry.sha256) {
		die(
			4,
			[
				`${entry.pkg} ${entry.inner} sha256 不匹配，拒绝生成 fixture：`,
				`  期望 ${entry.sha256}`,
				`  实际 ${got}`,
				'补丁按字节锚定旧版本；包已变化时必须重新生成补丁，不能用旧补丁继续。',
			].join('\n'),
		);
	}
	mkdirSync(dirname(entry.out), { recursive: true });
	writeFileSync(entry.out, buf);
	manifest.files[`${entry.pkg}/${entry.inner}`] = {
		version: entry.version,
		bytes: buf.length,
		sha256: got,
		path: entry.out.slice(REPO.length + 1),
	};
	console.log(`pristine  ${entry.pkg}/${entry.inner}  ${buf.length} B  ${got.slice(0, 16)}…`);
}

// ───────────────────────── 生成 patched fixture ─────────────────────────

// 子进程的 PATH 可能不含 /usr/bin，显式解析 patch 二进制。
const PATCH_BIN = ['/usr/bin/patch', '/bin/patch'].find((p) => existsSync(p)) ?? 'patch';

function runPatch(cwd, patchFile, extraArgs) {
	try {
		const out = execFileSync(PATCH_BIN, ['-p1', '-N', '--batch', ...extraArgs, '-i', patchFile], {
			cwd,
			stdio: 'pipe',
			encoding: 'utf8',
		});
		return { code: 0, text: out };
	} catch (error) {
		return {
			code: error.status ?? 2,
			text: `${error.stdout ?? ''}${error.stderr ?? ''}${error.code ? `\nspawn: ${error.code} ${error.message}` : ''}`,
		};
	}
}

const patched = LOCKED.filter((entry) => entry.patch);
for (const entry of patched) {
	const fixtureRoot = dirname(dirname(entry.patchedOut)); // .stage-hostpatch/fixtures/<pkg>
	const target = entry.patchedOut;
	if (!existsSync(entry.patch)) die(5, `补丁文件缺失：${entry.patch}`);
	if (force) rmSync(fixtureRoot, { recursive: true, force: true });

	mkdirSync(dirname(target), { recursive: true });
	copyFileSync(entry.out, target);

	// 1) dry-run 必须通过，否则不写任何内容
	const dry = runPatch(fixtureRoot, entry.patch, ['--dry-run']);
	if (dry.code !== 0) {
		die(5, `dry-run 失败（${entry.pkg}，rc=${dry.code}）：\n${dry.text.trim()}`);
	}
	// 2) 再真打
	const applied = runPatch(fixtureRoot, entry.patch, []);
	for (const junk of [`${target}.orig`, `${target}.rej`]) rmSync(junk, { force: true });
	if (applied.code !== 0) {
		die(5, `apply 失败（${entry.pkg}，rc=${applied.code}）：\n${applied.text.trim()}`);
	}
	const got = sha256(readFileSync(target));
	if (got !== entry.patchedSha256) {
		die(
			5,
			[
				`${entry.pkg} 打补丁后 sha256 与锁定值不一致：`,
				`  期望 ${entry.patchedSha256}`,
				`  实际 ${got}`,
			].join('\n'),
		);
	}

	// 3) 语法检查（产物是 ESM）
	const checkPath = join(dirname(target), 'client.check.mjs');
	copyFileSync(target, checkPath);
	try {
		execFileSync(process.execPath, ['--check', checkPath], { stdio: 'pipe' });
	} catch (error) {
		die(6, `node --check 失败（${entry.pkg}）：\n${`${error.stdout ?? ''}${error.stderr ?? ''}`.trim()}`);
	} finally {
		rmSync(checkPath, { force: true });
	}

	manifest.files[`${entry.pkg}/${entry.inner}`].patched = {
		patch: entry.patch.slice(REPO.length + 1),
		patchSha256: sha256(readFileSync(entry.patch)),
		bytes: readFileSync(target).length,
		sha256: got,
		path: target.slice(REPO.length + 1),
	};
	console.log(
		`patched   ${entry.pkg}/${entry.inner}  ${readFileSync(target).length} B  ${got.slice(0, 16)}…  ` +
			`(dry-run ok → apply ok → node --check ok)`,
	);
}

mkdirSync(dirname(join(STAGE, 'fixtures/manifest.json')), { recursive: true });
writeFileSync(join(STAGE, 'fixtures/manifest.json'), `${JSON.stringify(manifest, null, '\t')}\n`);

console.log('\nOK：fixture 已就绪（仅写入仓库内 .stage-hostpatch/，未触碰 app.asar / ~/.dsh）。');
console.log('测试：node test/workspaces-sessions-slot.test.mjs && node test/sidebar-navigation-action-slot.test.mjs');
closeSync(archiveFd);
