import * as vscode from 'vscode';
import { FoldersTreeDataProvider } from './tree/tree';
import { FolderItem } from './tree/tree_item';
import { TreeController } from './tree_controller';
import { updateDecorations } from './decorator';
import { deletePowerSearchState, loadPowerSearchState, savePowerSearchState } from './storage';


export async function activate(context: vscode.ExtensionContext) {

	const savedState = await loadPowerSearchState(context);

	let tree = new FoldersTreeDataProvider(savedState.nodes);
	tree.restoreSelectedFolder(savedState.selectedFolderPath);
	let controller = new TreeController(tree);
	const foldersTreeView = vscode.window.createTreeView('powersearch-explorer.folders', { treeDataProvider: tree, showCollapseAll: true, canSelectMany: true, dragAndDropController: tree });

	context.subscriptions.push(
		// vscode.window.registerTreeDataProvider('powersearch-explorer.folders', tree),
		foldersTreeView,
		foldersTreeView.onDidExpandElement((event) => tree.setExpanded(event.element, true)),
		foldersTreeView.onDidCollapseElement((event) => tree.setExpanded(event.element, false)),


		vscode.window.onDidChangeActiveTextEditor(() => updateDecorations(tree.getNodes())),
		vscode.commands.registerCommand('powersearch.colorSymbol', () => controller.onColorSymbol()),
		vscode.commands.registerCommand('powersearch.colorLine', () => controller.onColorLine()),
		vscode.commands.registerCommand('powersearch.colorSelection', () => controller.onColorSelection()),
		vscode.commands.registerCommand("powersearch.chooseFolderColor", async (folder, _) => controller.onChangeFolderColor(folder)),
		vscode.commands.registerCommand("powersearch.renameFolder", async (folder, _) => controller.onRenameFolder(folder)),
		vscode.commands.registerCommand("powersearch.removeFolder", async (folder, _) => controller.onRemoveFolder(folder)),
		vscode.commands.registerCommand("powersearch.addFolder", async (folder, _) => controller.onAddFolder(folder)),
		vscode.commands.registerCommand('powersearch.toggleFolderVisibilityShow', (item: FolderItem) => tree.toggleVisibility(item)),
		vscode.commands.registerCommand('powersearch.toggleFolderVisibilityHide', (item: FolderItem) => tree.toggleVisibility(item)),

		vscode.commands.registerCommand("powersearch.removeData", async (folder, _) => {
			const choice = await vscode.window.showWarningMessage('Clear all PowerSearch data for this workspace?', { modal: true }, 'Clear Data');
			if (choice !== 'Clear Data') {
				return;
			}
			tree.clear();
			return deletePowerSearchState(context);
		}),
		vscode.commands.registerCommand("powersearch.selectFolder", (folder, _) => controller.onSelectFolder(folder)),
		vscode.commands.registerCommand("powersearch.saveTree", async () => {
			return savePowerSearchState({
				nodes: tree.getNodes(),
				selectedFolderPath: tree.getSelectedFolderPath(),
			});
		}),
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
