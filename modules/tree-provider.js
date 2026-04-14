const vscode = require('vscode');
const https = require('https');
const pathUtils = require('./path-utils');
const path = require('path');

class PowerSchoolTreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, resourceUri, contextValue, remotePath, psApi, localRootPath, isCustom = false, hasCustomFiles = false, pluginName = undefined, pluginEnabled = undefined) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.contextValue = contextValue;
        this.remotePath = remotePath;
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        this.isCustom = isCustom;
        this.hasCustomFiles = hasCustomFiles; // Whether this folder contains any custom files
        this.pluginName = pluginName;
        this.pluginEnabled = pluginEnabled;
        this.builtInContent = undefined;  // populated after download (8.3)

        // Three-tier contextValue: file-plugin, file-custom, file (built-in)
        if (contextValue === 'file') {
            if (pluginName) {
                this.contextValue = 'file-plugin';
            } else if (isCustom) {
                this.contextValue = 'file-custom';
            }
            // else stays 'file' (built-in)
        } else {
            if (pluginName || isCustom) {
                this.contextValue = 'folder-custom';
            }
        }

        if (contextValue === 'file') {
            this.command = {
                command: 'ps-vscode-cpm.downloadFile',
                title: 'Download File',
                arguments: [this]
            };
            this.iconPath = this.getFileIcon();
            // Use custom URI scheme for resource decoration (drives FileDecorationProvider)
            if (pluginName) {
                this.resourceUri = vscode.Uri.parse(`plugin:${label}`);
            } else if (isCustom) {
                this.resourceUri = vscode.Uri.parse(`custom:${label}`);
            }
        } else {
            // For FOLDERS, keep the file-based resourceUri so FileDecorationProvider can work
            this.iconPath = this.getFolderIcon();
            // Don't override resourceUri - it's already set from the constructor parameter
        }

        // Tooltip with custom status
        let customStatus;
        if (pluginName) {
            const enabledStatus = pluginEnabled === false ? ' - Disabled' : '';
            customStatus = ` (Plugin: ${pluginName}${enabledStatus})`;
        } else if (isCustom) {
            customStatus = ' (Custom)';
        } else {
            customStatus = ' (Original PowerSchool)';
        }

        this.tooltip = contextValue === 'file' ?
            `${label}${customStatus}\nClick to download from PowerSchool` :
            `${label}${customStatus}`;

        // Don't set description for folders - keep folder names clean
    }
    
    getFileIcon() {
        // Safety check for null remotePath
        if (!this.remotePath) {
            console.warn('[TREE] Warning: TreeItem has null remotePath, using default icon');
            return new vscode.ThemeIcon('file');
        }
        
        const localPath = pathUtils.getLocalFilePathFromRemote(this.remotePath, this.localRootPath);
        const exists = require('fs').existsSync(localPath);
        if (this.pluginName) {
            // Plugin-provided file — purple
            return exists
                ? new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.interfaceForeground'))
                : new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('symbolIcon.interfaceForeground'));
        } else if (this.isCustom) {
            // User-created/customized — blue/orange
            return exists
                ? new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.classForeground'))
                : new vscode.ThemeIcon('file', new vscode.ThemeColor('editorWarning.foreground'));
        } else {
            // Built-in PowerSchool — gray
            return exists
                ? new vscode.ThemeIcon('file', new vscode.ThemeColor('disabledForeground'))
                : new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('disabledForeground'));
        }
    }

    getFolderIcon() {
        const path = require('path');
        const extensionPath = path.dirname(path.dirname(__filename));
        
        // Folders with custom files - orange icon
        if (this.hasCustomFiles) {
            return path.join(extensionPath, 'resources', 'icons', 'folder-custom.svg');
        }
        // Stock folders - gray icon
        return path.join(extensionPath, 'resources', 'icons', 'folder-stock.svg');
    }
}

class PowerSchoolTreeProvider {
    constructor(psApi, localRootPath) {
        this.psApi = psApi;
        // Use provided localRootPath, or fall back to getPluginFilesRoot if null
        this.localRootPath = localRootPath || pathUtils.getPluginFilesRoot();
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.treeCache = new Map();
        this.pluginMappings = null;  // Cache for plugin file mappings
        this.pluginFilePaths = null;  // Set of actual file paths (not folders)
        this.pluginMappingsLoaded = false;
        this.folderDecorations = new Map();  // Track folder decoration types by path
        /** @type {string|null} null = web_root mode; 'queries_root' | 'user_schema_root' = schema mode */
        this.schemaRoot = null;
    }
        setLocalRootPath(newRootPath) {
            this.localRootPath = newRootPath;
            this.refresh();
        }
    
    refresh() {
        this.treeCache.clear();
        this.pluginMappings = null;  // Clear plugin mappings cache
        this.pluginFilePaths = null;  // Clear file paths cache
        this.pluginMappingsLoaded = false;
        this.folderDecorations.clear();  // Clear folder decorations
        this._onDidChangeTreeData.fire();
    }
    
    /**
     * Normalize a file path for consistent lookup in plugin mappings
     */
    normalizePath(filePath) {
        // Remove leading slashes and normalize separators
        return filePath.replace(/^\/+/, '/').replace(/\\/g, '/');
    }
    
    async loadPluginMappings() {
        if (this.pluginMappingsLoaded) {
            return this.pluginMappings;
        }
        
        // Try to load from server-generated JSON file
        try {
            const pluginData = await this.psApi.getPluginMappingsFromJson();
            
            if (pluginData) {
                // Convert to Map format
                this.pluginMappings = new Map();
                this.pluginFilePaths = new Set();
                
                for (const [filePath, info] of Object.entries(pluginData)) {
                    const normalizedPath = this.normalizePath(filePath);
                    this.pluginMappings.set(normalizedPath, {
                        pluginName: info.plugin || info.pluginName || 'Unknown',
                        enabled: info.enabled !== false,
                        isCustom: true
                    });
                    this.pluginFilePaths.add(normalizedPath);
                }
            } else {
                this.pluginMappings = new Map();
                this.pluginFilePaths = new Set();
            }
        } catch (error) {
            this.pluginMappings = new Map();
            this.pluginFilePaths = new Set();
        }
        
        this.pluginMappingsLoaded = true;
        return this.pluginMappings;
    }
    
    async getTreeItem(element) {
        return element;
    }
    
    async getChildren(element) {
        // Initialize API if not already done
        if (!this.psApi.baseUrl) {
            try {
                this.psApi.initialize();
            } catch (error) {
                vscode.window.showErrorMessage(error.message);
                return [];
            }
        }
        
        // Ensure localRootPath is set
        if (!this.localRootPath) {
            this.localRootPath = pathUtils.getPluginFilesRoot();
            if (!this.localRootPath) {
                console.error('[TREE] ❌ Cannot determine local root path - no workspace folder open');
                // Show helpful message to user
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    // Only show this message once
                    if (!this._shownNoWorkspaceWarning) {
                        this._shownNoWorkspaceWarning = true;
                        vscode.window.showWarningMessage(
                            'PowerSchool CPM: Please open a workspace folder to use the file tree.',
                            'Open Folder'
                        ).then(selection => {
                            if (selection === 'Open Folder') {
                                vscode.commands.executeCommand('vscode.openFolder');
                            }
                        });
                    }
                }
                return [];
            }
        }
        
        if (!element) {
            // Root level - return top level folders
            return this.getChildrenForPath('/');
        } else {
            // Return children of this folder
            return this.getChildrenForPath(element.remotePath);
        }
    }
    
    async getChildrenForPath(folderPath) {
        // Check cache first
        if (this.treeCache.has(folderPath)) {
            return this.treeCache.get(folderPath);
        }
        
        try {
            // Load plugin mappings if not already loaded
            await this.loadPluginMappings();

            // Choose API path based on content root mode
            let folderData;
            if (this.schemaRoot) {
                // Schema root mode — use /ws/cpm/content
                folderData = await this.psApi.getSchemaRootTree(this.schemaRoot);
            } else {
                // web_root mode (default)
                folderData = await this.psApi.getFolderTree(folderPath, 1);
            }
            const children = [];
            
            if (folderData.folder) {
                // Create tree items for subfolders and files
                const treeItems = await this.createTreeItems(folderData.folder, folderPath);
                children.push(...treeItems);
            }
            
            // Cache the results
            this.treeCache.set(folderPath, children);
            return children;
            
        } catch (error) {
            console.error('[TREE] ❌ Error loading folder', folderPath, ':', error.message);
            console.error('[TREE] 🔍 Full error:', error);
            console.error('[TREE] 🔍 Stack trace:', error.stack);
            vscode.window.showErrorMessage(`Failed to load folder ${folderPath}: ${error.message}`);
            return [];
        }
    }
    
    async createTreeItems(folderData, currentPath) {
        const items = [];
        let hasCustomFiles = false;

        // Load plugin mappings if not already loaded (now just initializes empty maps)
        await this.loadPluginMappings();
        
        // Known files that exist but aren't returned by the tree API
        const hiddenFiles = {
            '/admin/reports/registration/js': [
                'elem_reg.json',
                'dist_reg.json', 
                'num_teachers.json',
                'school_cat_reg.json'
            ]
        };

        // Sort subfolders alphabetically and add to items
        if (folderData.subFolders) {
            // Filter out null/undefined items before sorting
            const validSubfolders = folderData.subFolders.filter(subfolder => {
                if (!subfolder || !subfolder.text) {
                    console.warn('[TREE] ⚠️ Skipping subfolder with null/undefined name in', currentPath);
                    return false;
                }
                return true;
            });
            
            const sortedSubfolders = validSubfolders.sort((a, b) =>
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );

            for (const subfolder of sortedSubfolders) {
                
                const folderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                // Recursively get subfolder items and check if any are custom
                const subfolderTree = await this.createTreeItems(subfolder, folderPath);
                const subfolderHasCustom = subfolderTree.some(child => child.isCustom || child.hasCustomFiles);
                if (subfolderHasCustom) hasCustomFiles = true;
                
                // Safety check for localRootPath
                if (!this.localRootPath) {
                    console.error('[TREE] ❌ localRootPath is null/undefined, cannot create folder URI');
                    continue;
                }
                
                const folderUri = vscode.Uri.file(path.join(this.localRootPath, folderPath.replace(/^\/+/g, '')));
                const item = new PowerSchoolTreeItem(
                    subfolder.text,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    folderUri,
                    'folder',
                    folderPath,
                    this.psApi,
                    this.localRootPath,
                    subfolder.custom,
                    subfolderHasCustom
                );
                items.push(item);
            }
        }

        // Sort pages alphabetically and add to items
        if (folderData.pages) {
            // Filter out null/undefined items before sorting
            const validPages = folderData.pages.filter(page => {
                if (!page || !page.text) {
                    console.warn('[TREE] ⚠️ Skipping file with null/undefined name in', currentPath);
                    return false;
                }
                return true;
            });
            
            const sortedPages = validPages.sort((a, b) =>
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );

            for (const page of sortedPages) {
                const filePath = currentPath === '/' ? `/${page.text}` : `${currentPath}/${page.text}`;
                
                const normalizedPath = this.normalizePath(filePath);
                
                // Check plugin mappings first, then fall back to page.custom flag
                const pluginInfo = this.pluginMappings?.get(normalizedPath);
                // page.pluginName from the tree API takes priority; JSON mappings are a fallback
                const resolvedPluginName = page.pluginName || pluginInfo?.pluginName;
                const resolvedPluginEnabled = pluginInfo?.enabled;
                const isCustom = page.custom === true || !!pluginInfo;

                if (isCustom) {
                    hasCustomFiles = true;
                }

                // Safety check for localRootPath
                if (!this.localRootPath) {
                    console.error('[TREE] ❌ localRootPath is null/undefined, cannot create file URI');
                    continue;
                }

                const fileUri = vscode.Uri.file(path.join(this.localRootPath, filePath.replace(/^\/+/g, '')));
                const item = new PowerSchoolTreeItem(
                    page.text,
                    vscode.TreeItemCollapsibleState.None,
                    fileUri,
                    'file',
                    filePath,
                    this.psApi,
                    this.localRootPath,
                    isCustom,
                    false,               // hasCustomFiles — not applicable for file nodes
                    resolvedPluginName,
                    resolvedPluginEnabled
                );
                
                items.push(item);
            }
        }
        
        // Add hidden files that aren't returned by the tree API
        if (hiddenFiles[currentPath]) {
            for (const fileName of hiddenFiles[currentPath]) {
                const filePath = `${currentPath}/${fileName}`;
                const normalizedPath = this.normalizePath(filePath);
                
                // Check if file already exists in items (shouldn't happen, but safety check)
                const alreadyExists = items.some(item => item.remotePath === filePath);
                if (alreadyExists) continue;
                
                // Check plugin mappings
                const pluginInfo = this.pluginMappings?.get(normalizedPath);
                const resolvedPluginName = pluginInfo?.pluginName;
                const resolvedPluginEnabled = pluginInfo?.enabled;
                const isCustom = pluginInfo ? pluginInfo.isCustom : true; // Assume custom if not in mappings

                if (isCustom) {
                    hasCustomFiles = true;
                }

                if (!this.localRootPath) {
                    console.error('[TREE] ❌ localRootPath is null/undefined, cannot create file URI');
                    continue;
                }

                const fileUri = vscode.Uri.file(path.join(this.localRootPath, filePath.replace(/^\/+/g, '')));
                const item = new PowerSchoolTreeItem(
                    fileName,
                    vscode.TreeItemCollapsibleState.None,
                    fileUri,
                    'file',
                    filePath,
                    this.psApi,
                    this.localRootPath,
                    isCustom,
                    false,               // hasCustomFiles — not applicable for file nodes
                    resolvedPluginName,
                    resolvedPluginEnabled
                );
                
                // Add tooltip indicating this is a manually-added file
                item.tooltip = `${fileName} (Custom - Not visible in CPM tree API)\nClick to download from PowerSchool`;
                
                items.push(item);
            }
        }

        return items;
    }
    
    hasCustomFilesInFolder(folderPath) {
        if (!this.pluginMappings) return false;
        
        const normalizedFolderPath = folderPath.toLowerCase();
        
        // Check if any plugin files are in this folder or subfolders
        for (const filePath of this.pluginMappings.keys()) {
            if (filePath.startsWith(normalizedFolderPath + '/')) {
                return true;
            }
        }
        
        return false;
    }
    
    isCustomFile(filePath) {
        // Custom file status is now determined from tree data (page.custom flag)
        // This method kept for compatibility but not actively used
        return false;
    }
    
    async downloadFile(treeItem) {
        try {
            const localFilePath = pathUtils.getLocalFilePathFromRemote(treeItem.remotePath, this.localRootPath);
            const fs = require('fs');
            const fileExistsLocally = fs.existsSync(localFilePath);

            // Fetch file content and metadata from server (also caches customContentId automatically)
            const serverData = await this.psApi.downloadFileWithMetadata(treeItem.remotePath);
            // Cache metadata on tree item for use during publish (8.2) and diff (8.5)
            treeItem.isCustom = serverData.isCustom;
            treeItem.builtInContent = serverData.rawResponse?.builtInText || '';
            const serverContent = serverData.content;

            // Check if local file exists and compare contents
            if (fileExistsLocally) {
                const localContent = pathUtils.readFile(localFilePath);
                const contentsMatch = localContent === serverContent;

                if (contentsMatch) {
                    // Files are identical - just open the file and ensure ID is cached
                    const document = await vscode.workspace.openTextDocument(localFilePath);
                    await vscode.window.showTextDocument(document);

                    vscode.window.showInformationMessage(`${treeItem.label} is up to date.`);
                    return { success: true, action: 'unchanged' };
                } else {
                    // Files differ - prompt user for action with Compare option
                    // Use a loop so user can view diff and return to make their choice
                    let resolved = false;
                    while (!resolved) {
                        const choice = await vscode.window.showWarningMessage(
                            `"${treeItem.label}" differs from the server version. What would you like to do?`,
                            { modal: true },
                            'Overwrite Local',
                            'Open Local',
                            'Compare'
                        );

                        if (choice === 'Overwrite Local') {
                            // Overwrite local file with server content
                            pathUtils.writeFile(localFilePath, serverContent);

                            this._onDidChangeTreeData.fire(treeItem);

                            const document = await vscode.workspace.openTextDocument(localFilePath);
                            await vscode.window.showTextDocument(document);

                            vscode.window.showInformationMessage(`Updated ${treeItem.label} from server.`);
                            return { success: true, action: 'overwritten' };

                        } else if (choice === 'Open Local') {
                            // Open local file without overwriting, but cache the customContentId
                            // so publishing will work efficiently
                            const document = await vscode.workspace.openTextDocument(localFilePath);
                            await vscode.window.showTextDocument(document);

                            vscode.window.showInformationMessage(
                                `Opened local ${treeItem.label}. Your changes are preserved and ready to publish.`
                            );
                            return { success: true, action: 'kept_local' };

                        } else if (choice === 'Compare') {
                            // Show diff between local and remote using virtual document for remote
                            const remoteUri = vscode.Uri.parse(`powerschool:${treeItem.remotePath}`);
                            const localUri = vscode.Uri.file(localFilePath);

                            await vscode.commands.executeCommand(
                                'vscode.diff',
                                localUri,
                                remoteUri,
                                `${treeItem.label}: Local ↔ Server`
                            );

                            // Wait for user to close the diff editor before returning to dialog
                            await new Promise((resolve) => {
                                const disposable = vscode.window.onDidChangeActiveTextEditor(() => {
                                    // Small delay to ensure diff is fully closed
                                    setTimeout(() => {
                                        disposable.dispose();
                                        resolve();
                                    }, 100);
                                });
                            });

                            // Loop continues - dialog will show again

                        } else {
                            // User cancelled or closed dialog
                            resolved = true;
                            return { success: false, message: 'Download cancelled by user', action: 'cancelled' };
                        }
                    }
                }
            } else {
                // Local file doesn't exist - prompt user for action
                const userChoice = await pathUtils.ensureLocalDir(localFilePath, {
                    isCustom: treeItem.isCustom,
                    fileName: treeItem.label,
                    localRootPath: this.localRootPath
                });

                if (!userChoice) {
                    return { success: false, message: 'Download cancelled by user', action: 'cancelled' };
                }

                if (userChoice === 'readonly') {
                    // Open as virtual read-only document without saving locally
                    const virtualUri = vscode.Uri.parse(`powerschool:${treeItem.remotePath}`);
                    const document = await vscode.workspace.openTextDocument(virtualUri);
                    await vscode.window.showTextDocument(document, { preview: true });
                    return { success: true, action: 'readonly' };
                }

                // userChoice === 'download': write locally and open
                pathUtils.writeFile(localFilePath, serverContent);

                const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
                vscode.window.showInformationMessage(`Downloaded ${treeItem.label} to ${relativeLocalPath}`);

                this._onDidChangeTreeData.fire(treeItem);

                const document = await vscode.workspace.openTextDocument(localFilePath);
                await vscode.window.showTextDocument(document);

                return { success: true, action: 'downloaded' };
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to download ${treeItem.label}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
    
    async publishFile(treeItem) {
        if (!treeItem || treeItem.contextValue !== 'file') {
            vscode.window.showErrorMessage('Invalid file selected.');
            return;
        }

        try {
            if (!this.localRootPath) {
                vscode.window.showErrorMessage('No workspace folder is open.');
                return;
            }

            const localFilePath = pathUtils.getLocalFilePathFromRemote(treeItem.remotePath, this.localRootPath);

            if (!require('fs').existsSync(localFilePath)) {
                vscode.window.showErrorMessage(`Local file not found: ${path.relative(this.localRootPath, localFilePath)}`);
                return;
            }

            const content = pathUtils.readFile(localFilePath);

            vscode.window.showInformationMessage(`Publishing ${treeItem.label} to PowerSchool...`);

            // Upload file — pass isCustom and builtInContent so uploadFileContent
            // knows whether to call customizeAsset first (for never-customized built-in files)
            const result = await this.psApi.uploadFileContent(treeItem.remotePath, content, {
                isCustom: treeItem.isCustom !== false, // default true if not yet downloaded
                builtInContent: treeItem.builtInContent || ''
            });

            vscode.window.showInformationMessage(`✅ Published ${treeItem.label} successfully!`);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to publish ${treeItem.label}: ${error.message}`);
        }
    }
    
    async publishCurrentFile() {
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('No active file to publish.');
            return;
        }

        if (!this.localRootPath) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }

        const filePath = activeEditor.document.fileName;
        const remotePath = pathUtils.getRemotePathFromLocal(filePath, this.localRootPath);

        // Create a temporary tree item for publishing
        const treeItem = new PowerSchoolTreeItem(
            path.basename(filePath),
            vscode.TreeItemCollapsibleState.None,
            vscode.Uri.file(filePath),
            'file',
            remotePath,
            this.psApi,
            this.localRootPath
        );

        await this.publishFile(treeItem);
    }

    /**
     * Delete a custom file from the PowerSchool server.
     * Shows a confirmation dialog before deleting.
     * @param {PowerSchoolTreeItem} treeItem - The tree item representing the file to delete
     */
    async deleteFileFromServer(treeItem) {
        if (!treeItem || !treeItem.remotePath) {
            vscode.window.showErrorMessage('No file selected for deletion.');
            return { success: false, message: 'No file selected' };
        }

        // Only allow deleting custom files
        if (!treeItem.isCustom) {
            vscode.window.showWarningMessage(
                'Only custom files can be deleted. Built-in PowerSchool files cannot be removed.'
            );
            return { success: false, message: 'Cannot delete built-in file' };
        }

        // Show confirmation dialog
        const fileName = treeItem.label;
        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete "${fileName}" from the PowerSchool server?\n\nThis action cannot be undone.`,
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirmation !== 'Delete') {
            return { success: false, message: 'Deletion cancelled by user' };
        }

        try {
            vscode.window.showInformationMessage(`Deleting ${fileName} from server...`);

            const result = await this.psApi.deleteFile(treeItem.remotePath);

            if (result.success) {
                vscode.window.showInformationMessage(`✅ Deleted ${fileName} from PowerSchool server.`);

                // Refresh the tree to reflect the deletion
                this.refresh();

                return { success: true };
            } else {
                vscode.window.showErrorMessage(`Failed to delete ${fileName}: ${result.message}`);
                return { success: false, message: result.message };
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to delete ${fileName}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
}

module.exports = { PowerSchoolTreeProvider, PowerSchoolTreeItem };