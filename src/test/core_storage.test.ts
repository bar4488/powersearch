import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PowerSearchCore, validateLocalConfig } from '../core/storage_core';
import { createFolderItem } from '../core/types';

suite('PowerSearchCore', () => {
	let root: string;
	let workspace: string;
	let storageRoot: string;

	setup(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'powersearch-core-'));
		workspace = path.join(root, 'workspace');
		storageRoot = path.join(workspace, '.powersearch');
		await fs.mkdir(workspace, { recursive: true });
	});

	teardown(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	test('initializes storage metadata and local config without VS Code APIs', async () => {
		const core = createCore(storageRoot, workspace);

		await core.initialize();

		const manifest = JSON.parse(await fs.readFile(path.join(storageRoot, 'manifest.json'), 'utf8'));
		const localConfig = JSON.parse(await fs.readFile(path.join(storageRoot, 'local.json'), 'utf8'));
		assert.strictEqual(manifest.schemaVersion, 2);
		assert.deepStrictEqual(localConfig, {
			version: 1,
			workspaceRoots: [{ name: 'workspace', path: workspace }],
		});
	});

	test('saves folders and indexes ranges through the core mutation API', async () => {
		const core = createCore(storageRoot, workspace);
		await core.initialize();
		const folder = createFolderItem({ id: 'fld_test', name: 'Test', children: [], references: [] });
		await core.saveFolders([folder]);

		const result = await core.addRanges([{
			key: { workspaceFolder: 'workspace', path: 'src/file.ts' },
			range: {
				start: { line: 1, character: 2 },
				end: { line: 1, character: 8 },
			},
		}], folder.id);

		assert.strictEqual(result.added, 1);
		assert.strictEqual(result.addedReferences.length, 1);
		const ranges = await core.getRangesForFile({ workspaceFolder: 'workspace', path: 'src/file.ts' });
		assert.strictEqual(ranges.length, 1);
		assert.strictEqual(ranges[0].folderId, folder.id);
	});

	test('validates local config shape and duplicate workspace names', () => {
		assert.throws(() => validateLocalConfig({
			version: 1,
			workspaceRoots: [
				{ name: 'workspace', path: workspace },
				{ name: 'workspace', path: workspace },
			],
		}), /duplicate workspace root name/);

		assert.throws(() => validateLocalConfig({
			version: 1,
			workspaceRoots: [{ name: 'workspace', path: 'relative/path' }],
		}), /absolute path/);
	});

	test('rejects missing workspace roots during initialization', async () => {
		const core = createCore(storageRoot, path.join(root, 'missing'));

		await assert.rejects(() => core.initialize(), /does not exist/);
	});
});

function createCore(storageRoot: string, workspace: string): PowerSearchCore {
	return new PowerSearchCore({
		storageRoot,
		storageLocationLabel: storageRoot,
		workspaces: [{ id: 'workspace', name: 'workspace' }],
		workspaceRoots: [{ name: 'workspace', path: workspace }],
	});
}
