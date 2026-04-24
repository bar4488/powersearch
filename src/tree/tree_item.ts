import * as crypto from 'crypto';
import * as vscode from 'vscode';

export type ParentNode = FolderItem | RootItem;
export type TreeNode = FolderItem;

export interface RootItem {
	type: 'root';
	children: FolderItem[];
}

export interface FolderData {
	id: string;
	name: string;
	children: FolderData[];
	color?: string;
	isHidden?: boolean;
	expanded?: boolean;
}

export interface FolderItem {
	type: 'folder';
	id: string;
	name: string;
	children: FolderItem[];
	color?: string;
	isHidden: boolean;
	expanded?: boolean;
	parent?: ParentNode;
}

export interface PositionData {
	line: number;
	character: number;
}

export interface RangeData {
	start: PositionData;
	end: PositionData;
}

export interface StoredRange {
	id: string;
	folderId: string;
	range: RangeData;
}

export function createFolderItem(data: Omit<FolderItem, 'type' | 'id' | 'isHidden'> & Partial<Pick<FolderItem, 'id' | 'isHidden'>>): FolderItem {
	return {
		type: 'folder',
		id: data.id ?? createId('fld'),
		isHidden: data.isHidden ?? false,
		...data,
	};
}

export function createId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

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
