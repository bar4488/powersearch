import * as vscode from 'vscode';
import { TagsTreeDataProvider } from './tree/tree';
import { createDecorationFromColor, isValidColor, setTagDecoration } from './utils';
import { TagItem, ReferenceData, TreeNode } from './tree/tag-item';

const defaultColors = [
    { 'name': 'Navy', 'value': '#001f3f' },
    { 'name': 'Blue', 'value': '#0074D9' },
    { 'name': 'Aqua', 'value': '#7FDBFF' },
    { 'name': 'Teal', 'value': '#39CCCC' },
    { 'name': 'Purple', 'value': '#B10DC9' },
    { 'name': 'Fuchsia', 'value': '#F012BE' },
    { 'name': 'Maroon', 'value': '#85144b' },
    { 'name': 'Red', 'value': '#FF4136' },
    { 'name': 'Orange', 'value': '#FF851B' },
    { 'name': 'Yellow', 'value': '#FFDC00' },
    { 'name': 'Olive', 'value': '#3D9970' },
    { 'name': 'Green', 'value': '#2ECC40' },
    { 'name': 'Lime', 'value': '#01FF70' },
    { 'name': 'Black', 'value': '#111111' },
    { 'name': 'Gray', 'value': '#AAAAAA' },
    { 'name': 'Silver', 'value': '#DDDDDD' },
    { 'name': 'White', 'value': '#FFFFFF' }
];

export function updateDecorations(nodes: TreeNode[]) {
    for (let node of nodes) {
        if (node.type === 'tag') {
            if (node.color !== undefined) {
                setTagDecoration(node);
            }
            updateDecorations(node.references);
        }
    }
}

export function disposeDecorations(nodes: TreeNode[]) {
    for (let node of nodes) {
        if (node.type === 'tag') {
            if (!!node.decoration) {
                node.decoration.dispose();
                node.decoration = undefined;
            }
            disposeDecorations(node.references);
        }
    }
}