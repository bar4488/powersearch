import * as vscode from 'vscode';
import { locationDataFrom, locationFrom } from './utils';
import { FolderData, LocationData, ParentNode, RootItem, TreeNode, createFolderItem, createReferenceItem } from './tree/tree_item';
import { parseTree } from './tree/tree_parser';

const STORAGE_DIRECTORY = '.powersearch';
const STATE_FILE = 'state.json';
const SCHEMA_VERSION = 1;
const LEGACY_WORKSPACE_STATE_KEY = 'treeData';

interface PowerSearchRootData {
	type: 'root';
	children: PowerSearchNodeData[];
}

type PowerSearchNodeData = PowerSearchFolderData | PowerSearchReferenceData;

interface PowerSearchFolderData {
	type: 'folder';
	name: string;
	children: PowerSearchNodeData[];
	location?: LocationData;
	color?: string;
	isHidden?: boolean;
	expanded?: boolean;
}

interface PowerSearchReferenceData {
	type: 'ref';
	location: LocationData;
}

interface PowerSearchUiData {
	selectedFolderPath: number[] | null;
}

interface PowerSearchStateFile {
	schemaVersion: typeof SCHEMA_VERSION;
	savedAt: string;
	tree: PowerSearchRootData;
	ui: PowerSearchUiData;
}

export interface PowerSearchState {
	nodes: TreeNode[];
	selectedFolderPath: number[] | null;
}

export async function loadPowerSearchState(context: vscode.ExtensionContext): Promise<PowerSearchState> {
	const stateUri = getStateUri();
	if (!stateUri) {
		void vscode.window.showWarningMessage('PowerSearch requires a workspace folder to persist data.');
		return emptyState();
	}

	try {
		const bytes = await vscode.workspace.fs.readFile(stateUri);
		return parseStateFile(new TextDecoder().decode(bytes));
	}
	catch (error) {
		if (!isFileNotFoundError(error)) {
			void vscode.window.showWarningMessage(`PowerSearch could not read ${STORAGE_DIRECTORY}/${STATE_FILE}; starting with an empty tree.`);
			return emptyState();
		}
	}

	const migratedState = loadLegacyWorkspaceState(context);
	if (migratedState.nodes.length > 0) {
		await savePowerSearchState(migratedState);
		await context.workspaceState.update(LEGACY_WORKSPACE_STATE_KEY, undefined);
	}
	return migratedState;
}

export async function savePowerSearchState(state: PowerSearchState): Promise<void> {
	const stateUri = getStateUri();
	const storageUri = getStorageDirectoryUri();
	if (!stateUri || !storageUri) {
		return;
	}

	const file: PowerSearchStateFile = {
		schemaVersion: SCHEMA_VERSION,
		savedAt: new Date().toISOString(),
		tree: {
			type: 'root',
			children: state.nodes.map(serializeNode),
		},
		ui: {
			selectedFolderPath: state.selectedFolderPath,
		},
	};

	await vscode.workspace.fs.createDirectory(storageUri);
	await vscode.workspace.fs.writeFile(stateUri, new TextEncoder().encode(JSON.stringify(file, null, 2) + '\n'));
}

export async function deletePowerSearchState(context: vscode.ExtensionContext): Promise<void> {
	const stateUri = getStateUri();
	if (stateUri) {
		try {
			await vscode.workspace.fs.delete(stateUri);
		}
		catch (error) {
			if (!isFileNotFoundError(error)) {
				throw error;
			}
		}
	}
	await context.workspaceState.update(LEGACY_WORKSPACE_STATE_KEY, undefined);
}

function parseStateFile(contents: string): PowerSearchState {
	const data = JSON.parse(contents) as PowerSearchStateFile;
	if (data.schemaVersion !== SCHEMA_VERSION || data.tree?.type !== 'root' || !Array.isArray(data.tree.children)) {
		throw new Error(`Unsupported PowerSearch state schema.`);
	}

	const root = { type: 'root' as const, references: [] as TreeNode[] };
	root.references = data.tree.children.map((node) => deserializeNode(node, root));
	return {
		nodes: root.references,
		selectedFolderPath: Array.isArray(data.ui?.selectedFolderPath) ? data.ui.selectedFolderPath : null,
	};
}

function serializeNode(node: TreeNode): PowerSearchNodeData {
	if (node.type === 'ref') {
		return {
			type: 'ref',
			location: locationDataFrom(node.location),
		};
	}

	const data: PowerSearchFolderData = {
		type: 'folder',
		name: node.name,
		children: node.references.map(serializeNode),
	};
	const location = locationDataFrom(node.location);
	if (location) {
		data.location = location;
	}
	if (node.color) {
		data.color = node.color;
	}
	if (node.isHidden !== undefined) {
		data.isHidden = node.isHidden;
	}
	if (node.expanded !== undefined) {
		data.expanded = node.expanded;
	}
	return data;
}

function deserializeNode(data: PowerSearchNodeData, parent: ParentNode | RootItem): TreeNode {
	if (data.type === 'ref') {
		return createReferenceItem({ location: locationFrom(data.location), parent });
	}

	const folder = createFolderItem({
		name: data.name,
		location: locationFrom(data.location),
		references: [],
		color: data.color,
		isHidden: data.isHidden ?? false,
		expanded: data.expanded,
		parent,
	});
	folder.references = data.children.map((child) => deserializeNode(child, folder));
	return folder;
}

function loadLegacyWorkspaceState(context: vscode.ExtensionContext): PowerSearchState {
	const loadedData: FolderData[] = context.workspaceState.get(LEGACY_WORKSPACE_STATE_KEY, []);
	const nodes = loadedData.map((node) => parseTree(node));
	return {
		nodes,
		selectedFolderPath: null,
	};
}

function emptyState(): PowerSearchState {
	return {
		nodes: [],
		selectedFolderPath: null,
	};
}

function getStateUri(): vscode.Uri | undefined {
	const storageUri = getStorageDirectoryUri();
	if (!storageUri) {
		return undefined;
	}
	return vscode.Uri.joinPath(storageUri, STATE_FILE);
}

function getStorageDirectoryUri(): vscode.Uri | undefined {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		return undefined;
	}
	return vscode.Uri.joinPath(workspaceFolder.uri, STORAGE_DIRECTORY);
}

function isFileNotFoundError(error: unknown): boolean {
	return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}
