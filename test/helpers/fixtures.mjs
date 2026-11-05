/**
 * 两个宿主补丁测试共用的 fixture 路径与「缺失即失败」策略。
 *
 * 设计：
 *  - 路径固定，全部在仓库内 `.stage-hostpatch/` 下，由 prepare-host-fixtures.mjs 生成。
 *  - **默认缺失直接 fail**（exit 1）并打印准备命令，避免"没 fixture 就静默 skip"漏测。
 *  - 只有显式 `--allow-skip` 才降级为跳过，且跳过必须显式打印。
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const STAGE = join(REPO, '.stage-hostpatch');

export const FIXTURES = {
	/** ui-slots 的 SlotCore（真实实现，来自 app.asar） */
	slots: join(STAGE, 'stage/ui-slots/lib/index.js'),
	/** ui-workspace 原始产物（补丁 0001 的输入） */
	workspacePristine: join(STAGE, 'stage/ui-workspace/lib/client.js'),
	/** ui-workspace 打过 0001 的产物 */
	workspacePatched: join(STAGE, 'fixtures/ui-workspace/lib/client.js'),
	/** ui-sidebar 原始产物（补丁 0002 的输入） */
	sidebarPristine: join(STAGE, 'stage/dsh-client-ui-sidebar/lib/client.js'),
	/** ui-sidebar 打过 0002 的产物 */
	sidebarPatched: join(STAGE, 'fixtures/ui-sidebar/lib/client.js'),
	/** 生成记录：包版本、每个文件的完整 sha256、补丁文件 sha256 */
	manifest: join(STAGE, 'fixtures/manifest.json'),
};

export const PREPARE_CMD = 'node test/helpers/prepare-host-fixtures.mjs';

export const allowSkip = process.argv.includes('--allow-skip');

/**
 * 断言所需 fixture 存在。
 * @param {string[]} keys FIXTURES 的键名
 * @returns {boolean} true = 可以继续；false = 已按 --allow-skip 降级（调用方应记录 skip）
 */
export function ensureFixtures(keys) {
	const missing = keys.filter((key) => {
		if (!(key in FIXTURES)) throw new Error(`未知 fixture 键: ${key}`);
		return !existsSync(FIXTURES[key]);
	});
	if (missing.length === 0) return true;

	const list = missing.map((key) => `  - ${key}: ${FIXTURES[key]}`).join('\n');
	if (allowSkip) {
		console.log(`  ! 缺少 fixture（已因 --allow-skip 降级为跳过，结果不代表通过）：\n${list}`);
		console.log(`  ! 补全：${PREPARE_CMD}`);
		return false;
	}
	console.error(
		[
			'缺少测试 fixture，拒绝在未验证的情况下给绿灯：',
			list,
			'',
			'请先准备（只读 app.asar，只写仓库内 .stage-hostpatch，不触碰 /Applications 与 ~/.dsh）：',
			`  ${PREPARE_CMD}`,
			'',
			'确实只想过一遍补丁文本断言时，才显式加：',
			`  node ${process.argv[1]} --allow-skip`,
		].join('\n'),
	);
	process.exit(1);
}
