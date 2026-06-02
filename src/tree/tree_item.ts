import * as vscode from 'vscode';
import {
	FolderData,
	FolderItem,
	ParentNode,
	PositionData,
	RangeData,
	ReferenceItem,
	RootItem,
	SavedSearchData,
	SearchScope,
	StoredRange,
	StoredRangeReference,
	TreeNode,
	VisibleRootItem,
	createFolderItem,
	createId,
	createReferenceItem,
	referenceKey,
	sameStoredRangeReference,
} from '../core/types';

export {
	FolderData,
	FolderItem,
	ParentNode,
	PositionData,
	RangeData,
	ReferenceItem,
	RootItem,
	SavedSearchData,
	SearchScope,
	StoredRange,
	StoredRangeReference,
	TreeNode,
	VisibleRootItem,
	createFolderItem,
	createId,
	createReferenceItem,
	referenceKey,
	sameStoredRangeReference,
};

export function rangeFromData(range: RangeData): vscode.Range {
	return new vscode.Range(
		new vscode.Position(range.start.line, range.start.character),
		new vscode.Position(range.end.line, range.end.character),
	);
}

export function rangeToData(range: vscode.Range): RangeData {
	return {
		start: {
			line: range.start.line,
			character: range.start.character,
		},
		end: {
			line: range.end.line,
			character: range.end.character,
		},
	};
}
