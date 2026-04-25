import { FolderData, FolderItem, createFolderItem } from "./tree_item";

export function parseTree(root: FolderData, parent: FolderItem | undefined = undefined): FolderItem {
    const rootItem = createFolderItem({
        id: root.id,
        name: root.name,
        color: root.color,
        inheritsColor: root.inheritsColor,
        isHidden: root.isHidden,
        expanded: root.expanded,
        children: [],
        references: [],
        parent,
    });
    rootItem.children = root.children.map((child) => parseTree(child, rootItem));
    return rootItem;
}

export function dumpTree(root: FolderItem): FolderData {
    return {
        id: root.id,
        name: root.name,
        children: root.children.map(dumpTree),
        color: root.color,
        inheritsColor: root.inheritsColor,
        isHidden: root.isHidden,
        expanded: root.expanded,
    };
}
