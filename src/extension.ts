import * as vscode from 'vscode';
import { FoldersTreeDataProvider } from './tree/tree';
import { FolderData, FolderItem, TreeData, TreeNode } from './tree/tree_item';
import { TreeController } from './tree_controller';
import { updateDecorations } from './decorator';
import { dumpTree, parseTree } from './tree/tree_parser';


function loadTree(context: vscode.ExtensionContext) {
	let loadedData: FolderData[] = context.workspaceState.get('treeData', []);
	let treeItems = loadedData.map((t) => parseTree(t));
	return treeItems;
}

function saveTreeItems(context: vscode.ExtensionContext, treeItems: TreeNode[]) {
	return context.workspaceState.update('treeData', treeItems.map((t) => dumpTree(t as FolderItem)));
}

function deleteTreeItems(context: vscode.ExtensionContext) {
	return context.workspaceState.update('treeData', undefined);
}


export function activate(context: vscode.ExtensionContext) {

	let treeItems = loadTree(context);

	let tree = new FoldersTreeDataProvider(treeItems);
	let controller = new TreeController(tree);

	const uri = vscode.window.activeTextEditor.document.uri;
	// console.log(uri);
	// console.log(uri.toString());
	// console.log(vscode.Uri.parse(uri.toString()));

	context.subscriptions.push(
		// vscode.window.registerTreeDataProvider('powersearch-explorer.folders', tree),
		vscode.window.createTreeView('powersearch-explorer.folders', { treeDataProvider: tree, showCollapseAll: true, canSelectMany: true, dragAndDropController: tree }),


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

		vscode.commands.registerCommand("powersearch.removeData", async (folder, _) => deleteTreeItems(context)),
		vscode.commands.registerCommand("powersearch.selectFolder", (folder, _) => controller.onSelectFolder(folder)),
		vscode.commands.registerCommand("powersearch.saveTree", async () => {
			return saveTreeItems(context, tree.getNodes());
		}),
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
