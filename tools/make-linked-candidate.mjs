#!/usr/bin/env node
/**
 * 生成「本地 linked 部署候选」：把本仓库的 bundle 原样复制到仓库内的暂存目录，
 * 并**只**把三处发布标识一起改成当前 runtime 里 linked 包的包名（默认 @local/activity-view）：
 *
 *   1. package.json     `"name": "dsh-activity-view"`         → `"name": "@local/activity-view"`
 *   2. client.js         `id: 'dsh-activity-view',`           → `id: '@local/activity-view',`
 *   3. cordis.patch.yml `name: dsh-activity-view`             → `name: "@local/activity-view"`
 *
 * 改写值一律按目标语法转义（#0011）：YAML 里 `@` 是保留指示符，不能作为 plain scalar
 * 的起始字符，`name: @local/activity-view` 会让解析器直接报
 * `found character that cannot start any token`；因此 YAML 一律输出双引号标量，
 * JS 输出单引号字面量、JSON 输出 JSON 字符串，都由本文件的转义函数统一产生。
 *
 * 为什么需要这一步（#0008 / #0010）：浏览器 asset 的 factory id 必须等于**运行那侧**的包名。
 * 仓库里包名是 dsh-activity-view（与 factory id、bundle row name 三处一致，可发布形态）；
 * runtime 里的 linked 包名是 @local/activity-view，所以候选只在复制出的副本里做这处转换。
 * 三处**必须同时**改：loader 用 row name 找包、client 注入器用包名对 factory id，
 * 只改其中一处就会得到 #0008 那类不匹配产物，因此本工具不提供「只改两处」的选项。
 *
 * 安全边界（#0010 修复要点，主审要求）：
 *  - **不删除任何目录**。候选目录名带源码内容指纹，
 *    `${name}-${version}-${fingerprint}-linked`；源码不变 ⇒ 同一目录名（重复执行只会
 *    报告「已存在、内容相同」，退出码 5，不覆盖、不删除）；源码变了 ⇒ 新目录名，
 *    旧候选原样保留，由人工决定去留。因此没有`--force`，也不需要先校验「要删的东西
 *    是不是我自己的」。
 *  - 写入前仍做归属/边界校验：候选根必须是仓库内 `.stage-candidate/` 的真实子目录，
 *    已存在的同名目标不得是符号链接（防止指向 workspace 外）。
 *  - 版本号必须是可安全用于路径的 semver 形态，否则拒绝生成。
 *  - 只写仓库内 `.stage-candidate/`：不写 ~/.dsh、不写 profile、不动 actual 的
 *    default-workspace/activity-view 目录，不装依赖、不重启、不调用 manager。
 *
 * 用法：
 *   node tools/make-linked-candidate.mjs                 # 生成候选 + 清单
 *   node tools/make-linked-candidate.mjs --dry-run       # 只打印计划（含候选目录名），不落盘
 *   node tools/make-linked-candidate.mjs --local-name @local/activity-view
 *
 * 退出码：
 *   0 成功
 *   2 用法错误（含未知参数、--local-name 缺参、包名不合法）
 *   3 源码缺文件 / package.json 与预期不符 / 改写点不唯一 / 版本号不安全
 *   4 目标包名与本仓库发布包名相同（无需生成候选）
 *   5 同内容候选已存在（未覆盖、未删除）
 *   6 候选路径越界或目标为符号链接（拒绝写入）
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const PATCHED_NAME = 'dsh-activity-view';
const DEFAULT_LOCAL_NAME = '@local/activity-view';
/** 候选根（仓库内、已 gitignore）。 */
export const STAGE_DIR = '.stage-candidate';

const LOCAL_NAME_PATTERN = /^@?[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)?$/;
const SAFE_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** 版本号会直接进候选目录名，只接受 semver 形态，避免 `../` 之类越界。 */
export function isSafeVersion(version) {
	return typeof version === 'string' && SAFE_VERSION_PATTERN.test(version);
}

/**
 * 三种目标语法的转义函数。**所有**改写值都必须经过其中之一，禁止直接模板拼接（#0011）。
 *  - yamlDoubleQuoted：YAML 双引号标量；JSON 字符串转义是 YAML 双引号的合法子集，
 *    因此直接复用 JSON.stringify，`@`、`#`、`:`、前导空格等保留/特殊字符都不会出问题。
 *  - jsSingleQuoted：JS 单引号字面量的**内容**（不含两侧引号）。
 *  - jsonString：JSON 字符串字面量（含引号）。
 */
export const yamlDoubleQuoted = (value) => JSON.stringify(value);
export const jsSingleQuoted = (value) =>
	JSON.stringify(value).slice(1, -1).replace(/\\"/g, '"').replace(/'/g, "\\'");
export const jsonString = (value) => JSON.stringify(value);

/** 候选内的改写规则：三处一起改，没有「只改两处」的开关。 */
export const REWRITES = [
	{
		file: 'package.json',
		from: `"name": "${PATCHED_NAME}"`,
		to: (localName) => `"name": ${jsonString(localName)}`,
		why: 'linked 部署的包名＝候选目录 package.json 的 name',
	},
	{
		file: 'client.js',
		from: `  id: '${PATCHED_NAME}',`,
		to: (localName) => `  id: '${jsSingleQuoted(localName)}',`,
		why: '浏览器 asset 的 factory id 必须等于运行侧包名（#0008）',
	},
	{
		file: 'cordis.patch.yml',
		from: `      name: ${PATCHED_NAME}`,
		to: (localName) => `      name: ${yamlDoubleQuoted(localName)}`,
		why: 'bundle row name 必须与包名一致；YAML 里 @ 不能起始 plain scalar，必须加引号（#0011）',
	},
];

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

/** 把 files 条目展开成具体文件清单（compat/ 这类目录要逐个文件算 hash）。 */
function expand(dir, entry) {
	const full = join(dir, entry);
	if (!statSync(full).isDirectory()) return [entry];
	return readdirSync(full)
		.sort()
		.flatMap((child) => expand(dir, `${entry}/${child}`));
}

/**
 * 内容指纹：进入候选的每个文件的相对路径 + **源内容** hash，加上包名/版本/目标包名，
 * 再叠加每条改写的最终替换结果（file + from + to）。
 *
 * 为什么必须含改写结果（#0011）：只 hash 源内容与 localName 时，改改写算法（例如把
 * `name: @x` 修成 `name: "@x"`）不会改变指纹，工具会命中旧目录并返回「已存在、内容相同」，
 * 于是修好的产物永远生成不出来。把「生成后的字节」纳入指纹后，改写算法变化 ⇒ 新目录名，
 * 旧候选原样保留。
 */
export function fingerprint(entries, meta, plan = []) {
	const hash = createHash('sha256');
	hash.update(`${meta.name}\u0000${meta.version}\u0000${meta.localName}\u0000`);
	hash.update('fingerprint-version\u00002\u0000');
	for (const entry of entries) hash.update(`${entry}\u0000${sha256(readFileSync(join(REPO, entry)))}\u0000`);
	for (const item of plan) hash.update(`rewrite\u0000${item.file}\u0000${item.from}\u0000${item.to}\u0000`);
	return hash.digest('hex').slice(0, 12);
}

/**
 * 候选路径必须落在 `<repo>/.stage-candidate/` 的真实子目录内。
 * @returns {string | undefined} 不合法时的原因
 */
function checkInsideStage(dest) {
	const stage = join(REPO, STAGE_DIR);
	if (!existsSync(stage)) return undefined;
	const stageReal = realpathSync(stage);
	if (existsSync(dest) && lstatSync(dest).isSymbolicLink()) return `候选路径是符号链接，拒绝写入：${dest}`;
	const parentReal = realpathSync(dirname(dest));
	if (parentReal !== stageReal && !parentReal.startsWith(stageReal + sep)) {
		return `候选路径越界（不在 ${relative(REPO, stage)} 之内）：${parentReal}`;
	}
	return undefined;
}

/**
 * @param {{ localName?: string, dryRun?: boolean }} [options]
 */
export function run(options = {}) {
	const localName = options.localName ?? DEFAULT_LOCAL_NAME;
	const dryRun = options.dryRun === true;
	const messages = [];
	const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

	if (pkg.name !== PATCHED_NAME) {
		return { code: 3, messages: [`源码 package.json name=${pkg.name}，预期 ${PATCHED_NAME}`] };
	}
	if (!isSafeVersion(pkg.version)) {
		return { code: 3, messages: [`package.json version=${pkg.version} 不是可安全用于路径的 semver，拒绝生成`] };
	}
	if (typeof localName !== 'string' || !LOCAL_NAME_PATTERN.test(localName)) {
		return { code: 2, messages: [`本地包名不合法：${localName}`] };
	}
	if (localName === pkg.name) {
		return { code: 4, messages: ['本地包名与发布包名相同，无需生成候选'] };
	}

	const list = Array.isArray(pkg.files) ? pkg.files : [];
	if (list.length === 0) return { code: 3, messages: ['package.json 缺 files 列表'] };

	// npm 打包一定带 package.json（它不在 files 白名单里），linked 部署也靠它声明包名
	const files = list.includes('package.json') ? [...list] : ['package.json', ...list];
	for (const entry of files) {
		if (!existsSync(join(REPO, entry))) return { code: 3, messages: [`files 里的条目不存在：${entry}`] };
	}
	const entries = files.flatMap((entry) => expand(REPO, entry));

	/** @type {Array<{ file: string, from: string, to: string, why: string }>} */
	const plan = [];
	for (const rule of REWRITES) {
		const source = readFileSync(join(REPO, rule.file), 'utf8');
		const hits = source.split(rule.from).length - 1;
		if (hits !== 1) {
			return { code: 3, messages: [`${rule.file} 里 "${rule.from}" 出现 ${hits} 次，预期恰好 1 次；请先核对源码`] };
		}
		plan.push({ file: rule.file, from: rule.from, to: rule.to(localName), why: rule.why });
	}

	const stamp = fingerprint(entries, { name: pkg.name, version: pkg.version, localName }, plan);
	const dest = join(REPO, STAGE_DIR, `${pkg.name}-${pkg.version}-${stamp}-linked`);
	const destReason = checkInsideStage(dest);
	if (destReason !== undefined) return { code: 6, messages: [destReason] };

	messages.push(`源码：${REPO}`);
	messages.push(`候选：${relative(REPO, dest)}（${pkg.name}@${pkg.version} → ${localName}，内容指纹 ${stamp}）`);
	messages.push(`随包条目 ${files.length} 个、展开后 ${entries.length} 个文件：${files.join(', ')}`);
	for (const item of plan) messages.push(`改写 ${item.file}: ${item.from.trim()} → ${item.to.trim()}（${item.why}）`);
	messages.push('本工具不删除任何目录：内容变化只会生成新指纹的候选目录，旧候选原样保留。');

	if (dryRun) {
		messages.push('--dry-run：未落盘');
		return { code: 0, messages, dest, plan };
	}

	if (existsSync(dest)) {
		return {
			code: 5,
			messages: [...messages, `候选目录已存在且内容指纹相同：${relative(REPO, dest)}（未覆盖、未删除；如需重建请换名或人工清理）`],
			dest,
		};
	}

	mkdirSync(dirname(dest), { recursive: true });
	const reasonAfterMkdir = checkInsideStage(dest);
	if (reasonAfterMkdir !== undefined) return { code: 6, messages: [reasonAfterMkdir] };
	mkdirSync(dest);

	/** @type {Record<string, { sourceSha256: string, candidateSha256: string, changed: boolean }>} */
	const hashes = {};
	for (const entry of files) cpSync(join(REPO, entry), join(dest, entry), { recursive: true });

	for (const rule of plan) {
		const path = join(dest, rule.file);
		writeFileSync(path, readFileSync(path, 'utf8').split(rule.from).join(rule.to));
	}

	for (const entry of entries) {
		const sourceBytes = readFileSync(join(REPO, entry));
		const candidateBytes = readFileSync(join(dest, entry));
		const sourceSha256 = sha256(sourceBytes);
		const candidateSha256 = sha256(candidateBytes);
		hashes[entry] = { sourceSha256, candidateSha256, changed: sourceSha256 !== candidateSha256 };
	}

	const manifest = {
		note: '本地 linked 部署候选清单：源码仓库保持发布形态（dsh-activity-view），候选副本仅把三处发布标识改为 runtime 的 linked 包名。',
		generatedFrom: REPO,
		sourceName: pkg.name,
		sourceVersion: pkg.version,
		localName,
		contentFingerprint: stamp,
		engines: pkg.engines ?? {},
		files,
		changedFiles: Object.keys(hashes).filter((path) => hashes[path].changed),
		rewrites: plan,
		sha256: hashes,
	};
	writeFileSync(join(dest, 'candidate.json'), `${JSON.stringify(manifest, null, 2)}\n`);

	messages.push(`候选清单：${relative(REPO, join(dest, 'candidate.json'))}`);
	messages.push('未触碰 ~/.dsh、profile 与 actual 的 default-workspace/activity-view 目录。');
	return { code: 0, messages, dest, plan, manifest };
}

/**
 * @param {string[]} argv
 */
function main(argv) {
	let localName = DEFAULT_LOCAL_NAME;
	let dryRun = false;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === '--dry-run') dryRun = true;
		else if (arg === '--local-name') {
			const value = argv[index + 1];
			index += 1;
			if (value === undefined) {
				console.error('--local-name 缺参数');
				return 2;
			}
			localName = value;
		} else {
			console.error(`未知参数 ${arg}`);
			return 2;
		}
	}
	const result = run({ localName, dryRun });
	for (const message of result.messages) console.log(message);
	return result.code;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(main(process.argv.slice(2)));
}
