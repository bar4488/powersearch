import * as vscode from 'vscode';
import { DecorationManager } from './decorator';
import { PowerSearchStorage } from './storage';
import { FoldersTreeDataProvider } from './tree/tree';
import { FolderItem, TreeNode } from './tree/tree_item';
import { TreeController } from './tree_controller';

export async function activate(context: vscode.ExtensionContext) {
	const storage = await PowerSearchStorage.open(context);
	if (!storage) {
		return;
	}

	const savedState = await storage.loadState();
	const tree = new FoldersTreeDataProvider(savedState.folders, storage, context.extensionUri);
	tree.restoreSelectedFolder(savedState.selectedFolderId);

	const decorations = new DecorationManager(storage, tree);
	const controller = new TreeController(tree, storage, decorations);
	const foldersTreeView = vscode.window.createTreeView('powersearch-explorer.folders', { treeDataProvider: tree, showCollapseAll: true, canSelectMany: true, dragAndDropController: tree });
	const targetStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

	const updateTargetStatus = () => {
		const folder = tree.getSelectedFolder();
		targetStatus.command = undefined;
		if (folder) {
			targetStatus.text = `$(folder) PowerSearch: ${folder.name}`;
			targetStatus.tooltip = 'Current target folder for new PowerSearch ranges';
		}
		else {
			targetStatus.text = '$(folder) PowerSearch: No target';
			targetStatus.tooltip = 'Right-click a folder to set it as the target for new PowerSearch ranges';
		}
		targetStatus.show();
	};

	updateTargetStatus();

	context.subscriptions.push(
		foldersTreeView,
		decorations,
		targetStatus,
		tree.onDidChangeTreeData(() => updateTargetStatus()),
		foldersTreeView.onDidExpandElement((event) => {
			if (event.element.type === 'folder') {
				tree.setExpanded(event.element, true);
			}
		}),
		foldersTreeView.onDidCollapseElement((event) => {
			if (event.element.type === 'folder') {
				tree.setExpanded(event.element, false);
			}
		}),
		vscode.window.onDidChangeVisibleTextEditors(() => decorations.updateVisibleEditors()),
		vscode.window.onDidChangeActiveTextEditor(() => decorations.updateVisibleEditors()),
		vscode.commands.registerCommand('powersearch.colorSymbol', () => controller.onColorSymbol()),
		vscode.commands.registerCommand('powersearch.colorLine', () => controller.onColorLine()),
		vscode.commands.registerCommand('powersearch.colorSelection', () => controller.onColorSelection()),
		vscode.commands.registerCommand('powersearch.chooseTargetFolder', (folder?: FolderItem) => controller.onChooseTargetFolder(folder)),
		vscode.commands.registerCommand('powersearch.clearTargetFolder', (folder?: FolderItem) => controller.onClearTargetFolder(folder)),
		vscode.commands.registerCommand('powersearch.openFolderDoc', (folder?: FolderItem) => controller.onOpenFolderDoc(folder)),
		vscode.commands.registerCommand('powersearch.chooseFolderColor', async (folder: FolderItem) => controller.onChangeFolderColor(folder)),
		vscode.commands.registerCommand('powersearch.renameFolder', async (folder: FolderItem) => controller.onRenameFolder(folder)),
		vscode.commands.registerCommand('powersearch.removeFolder', async (folder: FolderItem) => controller.onRemoveFolder(folder)),
		vscode.commands.registerCommand('powersearch.addFolder', async (folder?: FolderItem) => controller.onAddFolder(folder)),
		vscode.commands.registerCommand('powersearch.toggleFolderVisibilityShow', (item: FolderItem) => controller.onToggleFolderVisibility(item)),
		vscode.commands.registerCommand('powersearch.toggleFolderVisibilityHide', (item: FolderItem) => controller.onToggleFolderVisibility(item)),
		vscode.commands.registerCommand('powersearch.removeData', async () => {
			const choice = await vscode.window.showWarningMessage('Clear all PowerSearch data for this workspace?', { modal: true }, 'Clear Data');
			if (choice !== 'Clear Data') {
				return;
			}
			tree.clear();
			await storage.clearAll();
			await decorations.updateVisibleEditors();
		}),
		vscode.commands.registerCommand('powersearch.selectFolder', (node: TreeNode) => controller.onSelectNode(node)),
		vscode.commands.registerCommand('powersearch.saveTree', async () => {
			await storage.saveFolders(tree.getNodes());
			await storage.saveUi(tree.getSelectedFolderId());
		}),
	);

	await decorations.updateVisibleEditors();
}

export function deactivate() { }
