#!/usr/bin/env node
/**
 * 生成 / 校验 compat 下两个兼容包的 client 侧产物（可复现构建）。
 *
 * 产物 = 已安装应用 app.asar 内**原生**客户端 bundle
 *      + 仓库 patches/ 下已审的插槽补丁（0001 / 0002）
 *      + 包名命名空间统一替换（module id、CSS tagId、style.dataset.plugin）
 *
 * 不改任何其它字节：因此 `--check` 能当作“原生代码变更白名单”测试使用——
 * 只要产物与重建结果不完全相同，就说明有人在包里手写了原生代码之外的东西。
 *
 * 用法：
 *   node compat/lib/build.mjs            # 生成/覆盖两个兼容包的 lib/、LICENSE、locale/
 *   node compat/lib/build.mjs --check    # 只校验：不写盘，二者不一致则 exit 1
 *   node compat/lib/build.mjs --asar <path> [--check]
 *
 * 退出码：
 *   0 成功 / 一致
 *   1 --check 发现不一致
 *   2 用法错误
 *   3 asar 不可读或缺条目
 *   4 版本或 sha256 与 compat/vendor-lock.json 不符（应用已升级，先重新锁版）
 *   5 补丁上下文对不上（原生源码漂移）
 *
 * 只读边界：app.asar 只读不写；除 compat/ 目标目录外不落盘。
 */
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = JSON.parse(readFileSync(join(REPO, 'compat/vendor-lock.json'), 'utf8'));

class BuildError extends Error {
	/** @param {string} message @param {number} exitCode */
	constructor(message, exitCode) {
		super(message);
		this.exitCode = exitCode;
	}
}

/**
 * 读取 asar 内条目（直接解析 header，不依赖 Electron 的 asar 文件系统）。
 * @param {string} asar
 * @param {string[]} wanted asar 内路径
 * @returns {Map<string, Buffer>}
 */
function readAsarEntries(asar, wanted) {
	const fd = openSync(asar, 'r');
	try {
		const head = Buffer.alloc(16);
		readSync(fd, head, 0, 16, 0);
		const pickled = head.readUInt32LE(4);
		const jsonLength = head.readUInt32LE(12);
		const headerBytes = Buffer.alloc(jsonLength);
		readSync(fd, headerBytes, 0, jsonLength, 16);
		const header = JSON.parse(headerBytes.toString('utf8'));
		const base = 8 + pickled;

		/** @type {Map<string, { start: number, size: number } | { unpacked: true }>} */
		const index = new Map();
		/** @param {any} node @param {string} prefix */
		const walk = (node, prefix) => {
			for (const [name, child] of Object.entries(node.files ?? {})) {
				const path = prefix ? `${prefix}/${name}` : name;
				if (child.files) walk(child, path);
				else if (child.unpacked) index.set(path, { unpacked: true });
				else index.set(path, { start: base + Number(child.offset), size: Number(child.size) });
			}
		};
		walk(header, '');

		/** @type {Map<string, Buffer>} */
		const out = new Map();
		for (const path of wanted) {
			const entry = index.get(path);
			if (entry === undefined) throw new BuildError(`app.asar 缺少条目 ${path}`, 3);
			if ('unpacked' in entry) throw new BuildError(`条目 ${path} 是 unpacked，本工具不支持`, 3);
			const buffer = Buffer.alloc(entry.size);
			readSync(fd, buffer, 0, entry.size, entry.start);
			out.set(path, buffer);
		}
		return out;
	} finally {
		closeSync(fd);
	}
}

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/**
 * 把 `<pkg>/<file>` 形式的样式归属与 module id 统一到本地包名。
 * 只替换完整的包名字面量，不做正则改写，其余字节保持原样。
 */
function renameNamespace(source, nativeName, localName) {
	return source.split(nativeName).join(localName);
}

/**
 * 应用仓库内的 unified diff（仅支持本仓库补丁用到的子集）。
 * 上下文行逐字校验，不模糊匹配：源码漂移会立刻失败而不是静默错位。
 * @param {string} source
 * @param {string} diff
 * @param {string} label
 */
export function applyUnifiedDiff(source, diff, label) {
	/** @type {string[]} */
	const lines = source.split('\n');
	/** @type {Array<{ oldStart: number, oldCount: number, newCount: number, body: string[] }>} */
	const hunks = [];
	const diffLines = diff.endsWith('\n') ? diff.slice(0, -1).split('\n') : diff.split('\n');
	for (const raw of diffLines) {
		const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
		if (match !== null) {
			hunks.push({
				oldStart: Number(match[1]),
				oldCount: match[2] === undefined ? 1 : Number(match[2]),
				newCount: match[4] === undefined ? 1 : Number(match[4]),
				body: [],
			});
			continue;
		}
		if (hunks.length === 0) continue;
		if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
		if (raw.startsWith('--- ') || raw.startsWith('+++ ') || raw.startsWith('diff ')) continue;
		// 空行是内容为空白的上下文行（git 会写成单个空格，这里两种都接受）
		if (raw === '') {
			hunks.at(-1).body.push(' ');
			continue;
		}
		if (![' ', '+', '-'].includes(raw[0])) continue;
		hunks.at(-1).body.push(raw);
	}
	if (hunks.length === 0) throw new BuildError(`补丁里没有 hunk（${label}）：${label}`, 5);

	/** @type {string[]} */
	const out = [];
	let cursor = 0;
	for (const hunk of hunks) {
		// hunk 的起始行号始终是**原始文件**坐标，因此直接用 oldStart 定位，不做偏移补偿。
		const start = hunk.oldStart - 1;
		if (start < cursor || start > lines.length) {
			throw new BuildError(`${label}：hunk 位置越界（@@ -${hunk.oldStart}）`, 5);
		}
		out.push(...lines.slice(cursor, start));
		cursor = start;
		let consumed = 0;
		for (const body of hunk.body) {
			const kind = body[0];
			const text = body.slice(1);
			if (kind === '+') {
				out.push(text);
				continue;
			}
			const actual = lines[cursor];
			if (actual !== text) {
				throw new BuildError(
					`${label}：补丁上下文对不上（源第 ${cursor + 1} 行）\n  期望 ${JSON.stringify(text.slice(0, 120))}\n  实际 ${JSON.stringify(String(actual).slice(0, 120))}`,
					5,
				);
			}
			if (kind === ' ') out.push(text);
			cursor += 1;
			consumed += 1;
		}
		if (consumed !== hunk.oldCount) {
			throw new BuildError(
				`${label}：hunk 行数不符（@@ -${hunk.oldStart}）：声明 ${hunk.oldCount} 行，实际 ${consumed} 行`,
				5,
			);
		}
	}
	out.push(...lines.slice(cursor));
	return out.join('\n');
}

/**
 * 计算全部目标产物（不写盘）。
 * @param {{ asar?: string }} [options]
 * @returns {Array<{ target: string, relative: string, bytes: Buffer }>}
 */
export function plan(options = {}) {
	const asar = options.asar ?? LOCK.asarDefault;
	/** @type {Array<{ target: string, relative: string, bytes: Buffer }>} */
	const outputs = [];

	for (const [nativeName, spec] of Object.entries(LOCK.packages)) {
		const prefix = `node_modules/${nativeName}/`;
		const wanted = Object.keys(spec.files).map((relative) => prefix + relative);
		let entries;
		try {
			entries = readAsarEntries(asar, wanted);
		} catch (error) {
			if (error instanceof BuildError) throw error;
			throw new BuildError(`读不到 ${asar}：${error instanceof Error ? error.message : String(error)}`, 3);
		}

		for (const relative of Object.keys(spec.files)) {
			const actual = sha256(entries.get(prefix + relative));
			if (actual !== spec.files[relative]) {
				throw new BuildError(
					`${nativeName} 的 ${relative} 与 vendor-lock.json 锁定值不符：\n  锁定 ${spec.files[relative]}\n  实际 ${actual}\n` +
						`说明已安装应用与锁定的 ${spec.version} 不一致，请先复核并重新锁版。`,
					4,
				);
			}
		}

		const pristine = entries.get(`${prefix}lib/client.js`).toString('utf8');
		const diff = readFileSync(join(REPO, spec.patch), 'utf8');
		const patched = applyUnifiedDiff(pristine, diff, `${nativeName} ← ${spec.patch}`);
		const renamed = renameNamespace(patched, nativeName, spec.localName);

		for (const relative of Object.keys(spec.files)) {
			const bytes = relative === 'lib/client.js' ? Buffer.from(renamed, 'utf8') : entries.get(prefix + relative);
			outputs.push({ target: spec.target, relative, bytes });
		}
	}

	return outputs;
}

/**
 * @param {{ asar?: string, check?: boolean }} [options]
 * @returns {{ code: number, messages: string[] }}
 */
export function run(options = {}) {
	/** @type {string[]} */
	const messages = [];
	/** @type {Array<{ target: string, relative: string, bytes: Buffer }>} */
	let outputs;
	try {
		outputs = plan(options);
	} catch (error) {
		if (error instanceof BuildError) return { code: error.exitCode, messages: [error.message] };
		throw error;
	}

	let mismatched = 0;
	for (const { target, relative, bytes } of outputs) {
		const destination = join(REPO, target, relative);
		if (options.check) {
			let current;
			try {
				current = readFileSync(destination);
			} catch {
				messages.push(`缺少产物 ${target}/${relative}`);
				mismatched += 1;
				continue;
			}
			if (!current.equals(bytes)) {
				messages.push(`与重建结果不一致 ${target}/${relative}（${current.length} B ≠ ${bytes.length} B）`);
				mismatched += 1;
			}
		} else {
			mkdirSync(dirname(destination), { recursive: true });
			writeFileSync(destination, bytes);
			messages.push(`写入 ${target}/${relative}（${bytes.length} B, sha256 ${sha256(bytes).slice(0, 16)}…）`);
		}
	}

	if (options.check) {
		if (mismatched > 0) return { code: 1, messages };
		messages.push(`一致：${outputs.length} 个产物与「原生 bundle + 已审补丁 + 命名空间替换」的重建结果逐字节相同`);
		return { code: 0, messages };
	}
	return { code: 0, messages };
}

/**
 * @param {string[]} argv
 */
function main(argv) {
	/** @type {string | undefined} */
	let asar;
	let check = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--check') check = true;
		else if (arg === '--asar') {
			asar = argv[index + 1];
			index += 1;
			if (asar === undefined) {
				console.error('--asar 缺少路径');
				return 2;
			}
		} else {
			console.error(`未知参数 ${arg}`);
			return 2;
		}
	}
	const result = run({ asar, check });
	for (const message of result.messages) console.log(message);
	return result.code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(main(process.argv.slice(2)));
}
