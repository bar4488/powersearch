import * as crypto from 'crypto';
import * as vscode from 'vscode';

export type ParentNode = FolderItem | RootItem;
export type SearchScope = 'currentFile' | 'allWorkspaces' | 'selectedWorkspaces';
export type TreeNode = VisibleRootItem | FolderItem | ReferenceItem;

export interface RootItem {
	type: 'root';
	children: FolderItem[];
	color?: string;
	isHidden: boolean;
}

export interface VisibleRootItem {
	type: 'foldersRoot';
	name: string;
	expanded: boolean;
	color?: string;
	isHidden: boolean;
}

export interface SavedSearchData {
	id: string;
	name: string;
	pattern: string;
	isRegex: boolean;
	scope: SearchScope;
	workspaceNames?: string[];
	includes?: string;
	excludes?: string;
}

export interface FolderData {
	id: string;
	name: string;
	children: FolderData[];
	color?: string;
	inheritsColor?: boolean;
	isHidden?: boolean;
	expanded?: boolean;
}

export interface FolderItem {
	type: 'folder';
	id: string;
	name: string;
	children: FolderItem[];
	references: ReferenceItem[];
	color?: string;
	inheritsColor: boolean;
	isHidden: boolean;
	expanded?: boolean;
	parent?: ParentNode;
}

export interface StoredRangeReference {
	id: string;
	shard: string;
}

export interface ReferenceItem extends StoredRangeReference {
	type: 'ref';
	parent?: FolderItem;
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
	comment?: string;
}

type CreateFolderItemData =
	Omit<FolderItem, 'type' | 'id' | 'isHidden' | 'inheritsColor' | 'children' | 'references'>
	& Partial<Pick<FolderItem, 'id' | 'isHidden' | 'inheritsColor' | 'children' | 'references'>>;

export function createFolderItem(data: CreateFolderItemData): FolderItem {
	return {
		type: 'folder',
		...data,
		id: data.id ?? createId('fld'),
		isHidden: data.isHidden ?? false,
		inheritsColor: data.inheritsColor ?? false,
		children: data.children ?? [],
		references: data.references ?? [],
	};
}

export function createReferenceItem(data: Omit<ReferenceItem, 'type'>): ReferenceItem {
	return {
		type: 'ref',
		...data,
	};
}

export function referenceKey(reference: StoredRangeReference): string {
	return `${reference.id}\0${reference.shard}`;
}

export function sameStoredRangeReference(left: StoredRangeReference, right: StoredRangeReference): boolean {
	return left.id === right.id && left.shard === right.shard;
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
