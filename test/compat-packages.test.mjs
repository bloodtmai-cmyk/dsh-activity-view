#!/usr/bin/env node
/**
 * 两个兼容包（compat/ui-sidebar、compat/ui-workspace）的发布契约测试。
 *
 * 边界说明（不要对外扩大）：
 *  - 这里只做**导出/样式标记的形状断言**。自造的万能 require 与假 document 让 bundle 的
 *    factory 能跑到结尾，因此能核对 loader.load 的入参 id、导出 apply/inject 的类型与
 *    注入的 <style> 的 data-* 标记；它**不能**证明这些包在真实 Loader / 浏览器里可装载、
 *    可渲染，真实装载只能在 GUI 验收阶段确认。
 *  - "除补丁外没动原生代码" 由 `compat/lib/build.mjs --check` 逐字节重建比对保证；
 *    "未改字节的宿主/locale 与锁定原件一致" 由 vendor-lock 的 sha256 直接校验，
 *    不依赖任何私有暂存目录（`.stage-hostpatch/` 不在交付物内）。
 *
 * 断言分组：
 *  A. 形状：`window.__ModuleLoader__.load({ id, factory })` 的 id == manifest name，
 *     factory 可执行并导出 apply 函数与 inject 服务名列表（与原生一致）。
 *  B. CSS 归属：工厂执行时注入 2（sidebar）/ 3（workspace）个 <style>，
 *     每个的 data-plugin == 本地包名、data-plugin-css == `<本地包名>/<file>.module.css`。
 *  C. 命名空间：bundle 内不再出现原生包名字面量；`const NS` 保持原生值（locale 契约）。
 *  D. manifest 形态：private / type module / engines.dsh / exports 齐全 / dsh.client.platform=web /
 *     交叉引用改写为 compat 对端 / 无 types、无未随包分发的导出。
 *  E. 来源与可复现：vendor-lock 逐文件 sha256 与本地文件相符；build.mjs --check 逐字节一致。
 *     asar 缺失默认**失败**（给出标准构建命令），只有显式 DSH_COMPAT_ALLOW_SKIP_ASAR=1 才跳过。
 *
 * 运行：node --test --test-isolation=none test/compat-packages.test.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK = JSON.parse(readFileSync(join(REPO, 'compat/vendor-lock.json'), 'utf8'));

/** @type {Array<{ local: string, native: string, dir: string, patch: string, cssTags: number, injectCross: string, inject: string[] }>} */
const PACKAGES = [
	{
		local: '@local/activity-ui-sidebar',
		native: '@deepseek-ai/dsh-client-ui-sidebar',
		dir: 'compat/ui-sidebar',
		patch: 'patches/0002-sidebar-navigation-action-slot.patch',
		cssTags: 2,
		injectCross: '@local/activity-ui-workspace',
		inject: ['slots', 'layout', 'uiWorkspace', 'locale', 'shortcuts'],
	},
	{
		local: '@local/activity-ui-workspace',
		native: '@deepseek-ai/dsh-client-ui-workspace',
		dir: 'compat/ui-workspace',
		patch: 'patches/0001-sidebar-workspaces-sessions-slot.patch',
		cssTags: 3,
		injectCross: '@local/activity-ui-sidebar',
		inject: [
			'contextMenus',
			'slots',
			'sessions',
			'workspaces',
			'locale',
			'remote',
			'remote.directoryPicker',
			'layout',
			'shortcuts',
			'remoteAccess',
		],
	},
];

const read = (relative) => readFileSync(join(REPO, relative), 'utf8');

/** 与原生逐字节相同、因此必须命中 vendor-lock sha256 的文件（其余差异只允许来自已审补丁）。 */
const UNCHANGED_FILES = [
	'lib/index.js',
	'LICENSE',
	'locale/de.json',
	'locale/en.json',
	'locale/es.json',
	'locale/fr.json',
	'locale/ja.json',
	'locale/pt.json',
	'locale/ru.json',
	'locale/zh.json',
];

/** 只有被补丁改动过的产物文件允许与锁定 sha256 不同。 */
const PATCHED_FILES = ['lib/client.js'];

const sha256 = (relative) =>
	createHash('sha256')
		.update(readFileSync(join(REPO, relative)))
		.digest('hex');

/**
 * 自造的 require 桩：任何模块名都返回"万能可调用对象"。
 * 仅用于让 factory 跑到底以观察导出与 CSS 标记，**不代表真实模块可解析**。
 */
function magicModule() {
	const target = function magic() {};
	const handler = {
		get(_target, key) {
			if (key === 'then') return undefined;
			if (key === Symbol.iterator) return function* empty() {};
			if (key === Symbol.toPrimitive) return () => '';
			if (key === Symbol.toStringTag) return 'MagicModule';
			if (key === 'toString' || key === 'valueOf') return () => '';
			return proxy;
		},
		apply: () => proxy,
		construct: () => proxy,
	};
	const proxy = new Proxy(target, handler);
	return proxy;
}

/** 假 document：记录被注入的 <style> 标签，不实现渲染。 */
function fakeDocument() {
	/** @type {Array<{ dataset: Record<string, string>, textContent: string }>} */
	const appended = [];
	return {
		appended,
		document: {
			querySelector: () => null,
			createElement: () => ({ dataset: {}, textContent: '' }),
			head: {
				appendChild: (tag) => {
					appended.push(tag);
					return tag;
				},
			},
		},
	};
}

/**
 * 在独立 vm 上下文里执行 bundle，拿到 loader 收到的 { id, factory }，并执行 factory。
 * @param {{ dir: string, local: string }} spec
 */
function loadBundle(spec) {
	const source = read(`${spec.dir}/lib/client.js`);
	// 语法检查：不执行，仅编译（bundle 是普通脚本，不是 ESM）。
	new vm.Script(source, { filename: `${spec.dir}/lib/client.js` });

	/** @type {Array<{ id: string, factory: (require: (name: string) => unknown) => any }>} */
	const loaded = [];
	const { document, appended } = fakeDocument();
	const sandbox = {
		window: { __ModuleLoader__: { load: (entry) => loaded.push(entry) } },
		document,
		console,
	};
	vm.createContext(sandbox);
	new vm.Script(source, { filename: `${spec.dir}/lib/client.js` }).runInContext(sandbox);

	assert.equal(loaded.length, 1, `${spec.local}：loader.load 应恰好被调用一次`);
	const entry = loaded[0];
	return { entry, appended, exports: entry.factory(() => magicModule()) };
}

for (const spec of PACKAGES) {
	test(`${spec.local}：导出与样式标记形状断言（VM 桩，不代表真实 loadable）`, () => {
		const manifest = JSON.parse(read(`${spec.dir}/package.json`));
		const { entry, exports: bundleExports } = loadBundle(spec);

		assert.equal(entry.id, manifest.name, '浏览器模块 id 必须等于 manifest 包名');
		assert.equal(entry.id, spec.local);
		assert.equal(typeof entry.factory, 'function');

		assert.equal(typeof bundleExports.apply, 'function', '宿主侧 apply 必须是函数');
		assert.deepEqual([...bundleExports.inject], spec.inject, 'inject 服务名必须与原生一致');
		assert.equal(bundleExports.default, undefined, 'bundle 不应额外导出 default');
	});

	test(`${spec.local}：样式标记形状断言——CSS 归属统一到本地包名（${spec.cssTags} 个 style 标签）`, () => {
		const { appended } = loadBundle(spec);

		assert.equal(appended.length, spec.cssTags, `应注入 ${spec.cssTags} 个 style 标签`);
		const tagIds = appended.map((tag) => tag.dataset.pluginCss);
		assert.equal(new Set(tagIds).size, spec.cssTags, 'style 标签不应重复注入同一文件');
		for (const tag of appended) {
			assert.equal(tag.dataset.plugin, spec.local, 'data-plugin 必须是本地包名');
			assert.match(
				tag.dataset.pluginCss,
				new RegExp(`^${spec.local.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}/[^/]+\\.module\\.css$`),
				'data-plugin-css 必须是 `<本地包名>/<file>.module.css`',
			);
			assert.ok(tag.textContent.length > 0, 'style 标签必须带 CSS 文本');
		}
	});

	test(`${spec.local}：命名空间已替换，locale 命名空间保持原生值`, () => {
		const source = read(`${spec.dir}/lib/client.js`);

		assert.equal(source.split(spec.native).length - 1, 0, '包内不应残留原生包名字面量');
		// NS 是原生 locale 契约（插槽以 locale: NS 传给子项），刻意保持不变
		const ns = /const NS = "([^"]+)";/.exec(source);
		assert.ok(ns !== null, '应能找到 locale 命名空间常量');
		assert.equal(ns[1], spec.native.split('-ui-')[1], 'NS 必须保持原生值');
	});

	test(`${spec.local}：manifest 形态符合 web 客户端插件契约`, () => {
		const manifest = JSON.parse(read(`${spec.dir}/package.json`));

		assert.equal(manifest.name, spec.local);
		assert.equal(manifest.version, LOCK.packages[spec.native].version, '版本必须与锁定的原生版本一致');
		assert.equal(manifest.private, true, '本地兼容包不应被发布');
		assert.equal(manifest.type, 'module');
		assert.equal(manifest.license, 'MIT');
		assert.equal(manifest.types, undefined, '未随包分发 .d.ts，不应声明 types');
		assert.equal(manifest.dependencies, undefined, '不应引入运行期依赖');
		assert.equal(manifest.devDependencies, undefined, '不应引入开发期依赖');
		assert.deepEqual(manifest.peerDependencies, { '@deepseek-ai/cordis': '~4.1.0' });
		// 与 root bundle 保持同一运行时版本约束；版本约束本身不保证导入一定成功
		assert.deepEqual(manifest.engines, JSON.parse(read('package.json')).engines, 'engines 必须与 root 一致');

		for (const key of ['.', './client', './icon', './package.json', './locale/*.json']) {
			assert.ok(manifest.exports[key] !== undefined, `exports 缺 ${key}`);
		}

		const client = manifest.dsh?.client;
		assert.ok(client !== undefined, 'dsh.client 必须存在');
		assert.equal(client.platform, 'web');
		assert.equal(client.immediately, undefined, '不应声明 immediately');
		assert.ok(Array.isArray(client.inject) && client.inject.length > 0, 'inject 必须是非空数组');
		for (const name of client.inject) assert.equal(typeof name, 'string');
		assert.ok(client.inject.includes(spec.injectCross), '交叉引用必须指向 compat 对端');
		assert.ok(!client.inject.includes(spec.native), '不应再引用自身原生包名');

		// 声明的入口与随包文件必须真实存在
		assert.ok(existsSync(join(REPO, spec.dir, 'lib/index.js')));
		assert.ok(existsSync(join(REPO, spec.dir, 'lib/client.js')));
		assert.ok(existsSync(join(REPO, spec.dir, 'icon.svg')));
		assert.ok(existsSync(join(REPO, spec.dir, 'LICENSE')));
		assert.ok(existsSync(join(REPO, spec.dir, 'README.md')));
	});
}

test('兼容包与原生包各自独立：包名互不相同，未改字节的文件与 vendor-lock sha256 相符', () => {
	const locals = PACKAGES.map((spec) => spec.local);
	assert.equal(new Set(locals).size, locals.length, '两个 compat 包名必须互不相同');
	for (const spec of PACKAGES) {
		assert.notEqual(spec.local, spec.native);
		const locked = LOCK.packages[spec.native].files;
		for (const file of UNCHANGED_FILES) {
			assert.match(locked[file] ?? '', /^[0-9a-f]{64}$/, `vendor-lock 缺 ${spec.native} 的 ${file}`);
			assert.equal(
				sha256(`${spec.dir}/${file}`),
				locked[file],
				`${spec.local}/${file} 必须与锁定原件逐字节相同（宿主/locale 不做任何改写）`,
			);
		}
		for (const file of PATCHED_FILES) {
			assert.match(locked[file] ?? '', /^[0-9a-f]{64}$/, `vendor-lock 缺 ${spec.native} 的 ${file}`);
			assert.notEqual(
				sha256(`${spec.dir}/${file}`),
				locked[file],
				`${spec.local}/${file} 只应因已审补丁而不同；逐字节校验由 build.mjs --check 负责`,
			);
		}
	}
});

test('vendor-lock 锁到 0.2.2-rc.1 且逐文件哈希齐全', () => {
	assert.equal(LOCK.asarDefault, '/Applications/DSH NEXT.app/Contents/Resources/app.asar');
	assert.equal(LOCK.appVersion, '2.0.22-next');
	for (const spec of PACKAGES) {
		const entry = LOCK.packages[spec.native];
		assert.ok(entry !== undefined, `vendor-lock 缺 ${spec.native}`);
		assert.equal(entry.version, '0.2.2-rc.1');
		assert.equal(entry.localName, spec.local);
		assert.equal(entry.target, spec.dir);
		assert.equal(entry.patch, spec.patch);
		for (const file of ['lib/client.js', 'lib/index.js', 'LICENSE', 'locale/zh.json', 'locale/en.json']) {
			assert.match(entry.files[file] ?? '', /^[0-9a-f]{64}$/, `${spec.native} 缺 ${file} 的 sha256`);
		}
	}
});

test('产物可复现：与「原生 + 已审补丁 + 命名空间替换」重建结果逐字节相同', async () => {
	const asar = process.env.DSH_COMPAT_ASAR ?? LOCK.asarDefault;
	if (!existsSync(asar)) {
		if (process.env.DSH_COMPAT_ALLOW_SKIP_ASAR === '1') {
			console.warn(`[skip] DSH_COMPAT_ALLOW_SKIP_ASAR=1 且未安装 ${asar}，跳过可复现性校验`);
			return;
		}
		assert.fail(
			`找不到原生 asar：${asar}\n` +
				'可复现性校验默认必须执行，请先准备原生产物后重跑：\n' +
				'  1) 安装对应版本的 DSH NEXT 应用（锁定的 asarDefault 见 compat/vendor-lock.json）\n' +
				'  2) 生成/校验：node compat/lib/build.mjs --check\n' +
				'  3) 换机或自定义路径时：node compat/lib/build.mjs --check --asar <app.asar 路径>\n' +
				'确实要跳过请显式设置 DSH_COMPAT_ALLOW_SKIP_ASAR=1（跳过即视为未验证可复现性）。',
		);
	}
	const { run } = await import('../compat/lib/build.mjs');
	const result = run({ check: true, asar });
	assert.equal(result.code, 0, result.messages.join('\n'));
});
