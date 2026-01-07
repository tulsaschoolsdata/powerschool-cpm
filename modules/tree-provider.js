const vscode = require('vscode');
const https = require('https');
const pathUtils = require('./path-utils');
const path = require('path');

class PowerSchoolTreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, resourceUri, contextValue, remotePath, psApi, localRootPath, isCustom = false, hasCustomFiles = false) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.contextValue = contextValue;
        this.remotePath = remotePath;
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        this.isCustom = isCustom;
        this.hasCustomFiles = hasCustomFiles; // Whether this folder contains any custom files
        
        // Plugin metadata (set from JSON mappings if available)
        this.pluginName = undefined;
        this.pluginEnabled = undefined;

        // Update contextValue to include custom status
        if (isCustom) {
            this.contextValue = contextValue === 'file' ? 'file-custom' : 'folder-custom';
        }

        if (contextValue === 'file') {
            this.command = {
                command: 'ps-vscode-cpm.downloadFile',
                title: 'Download File',
                arguments: [this]
            };
            this.iconPath = this.getFileIcon();
            // Use custom URI scheme for resource decoration
            if (isCustom) {
                this.resourceUri = vscode.Uri.parse(`custom:${label}`);
            }
        } else {
            // For FOLDERS, keep the file-based resourceUri so FileDecorationProvider can work
            this.iconPath = this.getFolderIcon();
            // Don't override resourceUri - it's already set from the constructor parameter
        }

        // Enhanced tooltip with custom status
        let customStatus = '';
        if (isCustom) {
            if (this.pluginName) {
                const enabledStatus = this.pluginEnabled === false ? ' - Disabled' : '';
                customStatus = ` (Plugin: ${this.pluginName}${enabledStatus})`;
            } else {
                customStatus = ' (Custom)';
            }
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
        // Custom files get blue/orange color
        if (this.isCustom) {
            if (exists) {
                // Custom file, downloaded locally - blue
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.classForeground'));
            } else {
                // Custom file, not downloaded - orange
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('editorWarning.foreground'));
            }
        } else {
            // Original PowerSchool files - gray color
            if (exists) {
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('disabledForeground'));
            } else {
                return new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('disabledForeground'));
            }
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
            
            // Get folder contents from PowerSchool
            const folderData = await this.psApi.getFolderTree(folderPath, 1);
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
                const isCustom = page.custom === true || (pluginInfo && pluginInfo.isCustom);
                
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
                    isCustom
                );
                
                // Set plugin metadata if available from JSON mappings
                if (pluginInfo) {
                    item.pluginName = pluginInfo.pluginName;
                    item.pluginEnabled = pluginInfo.enabled;
                }
                
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
                    isCustom
                );
                
                // Set plugin metadata if available
                if (pluginInfo) {
                    item.pluginName = pluginInfo.pluginName;
                    item.pluginEnabled = pluginInfo.enabled;
                }
                
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
<<<<<<< HEAD:src/tree-provider.js
            const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
            const warningMsg = `This will create the following file and folders on your local system:\n${relativeLocalPath}\n\nContinue?`;
            const confirm = await vscode.window.showWarningMessage(warningMsg, { modal: true }, 'Yes');
            if (confirm !== 'Yes') {
                return { success: false, message: 'User cancelled download.' };
            }

            console.log(`📥 Downloading: ${treeItem.remotePath}`);
            console.log(`   Plugin files root: ${this.localRootPath}`);
            console.log(`   Target file path: ${localFilePath}`);
=======
>>>>>>> 25f6429057aac1ebbaf1ce01ec19e31c5958fbff:modules/tree-provider.js

            const dirCreated = await pathUtils.ensureLocalDir(localFilePath, {
                isCustom: treeItem.isCustom,
                fileName: treeItem.label,
                localRootPath: this.localRootPath
            });
            if (!dirCreated) {
                // User cancelled - don't proceed with download
                return { success: false, message: 'Download cancelled by user' };
            }

            vscode.window.showInformationMessage(`Downloading ${treeItem.label}...`);

            const fileContent = await this.psApi.downloadFileContent(treeItem.remotePath);
            const fileExists = require('fs').existsSync(localFilePath);

            pathUtils.writeFile(localFilePath, fileContent);

<<<<<<< HEAD:src/tree-provider.js
            console.log(`✅ Downloaded: ${treeItem.remotePath}`);
=======
            const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
>>>>>>> 25f6429057aac1ebbaf1ce01ec19e31c5958fbff:modules/tree-provider.js
            vscode.window.showInformationMessage(
                `${fileExists ? 'Updated' : 'Downloaded'} ${treeItem.label} to ${relativeLocalPath}`
            );

            this._onDidChangeTreeData.fire(treeItem);

            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);

            // Immediately cache customContentId after download (for fast publish)
            try {
                await this.psApi.downloadFileInfo(treeItem.remotePath);
            } catch (err) {
                // Silent - not critical
            }
            return { success: true };
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to download ${treeItem.label}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
<<<<<<< HEAD:src/tree-provider.js

    async downloadFileContent(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        const endpoint = '/ws/cpm/builtintext';
        await this.psApi.ensureAuthenticated(endpoint);
        const options = {
            hostname: new URL(this.psApi.baseUrl).hostname,
            port: 443,
            path: `${endpoint}?${queryParams.toString()}`,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'Referer': `${this.psApi.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Cookie': this.psApi.getCookieHeader()
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200) {
                            // Prefer real content, avoid saving 'not available' message
                            const notAvailableMsg = 'Active custom file';
                            let content = '';
                            if (response.activeCustomText && !response.activeCustomText.startsWith(notAvailableMsg)) {
                                content = response.activeCustomText;
                            } else if (response.builtInText && !response.builtInText.startsWith(notAvailableMsg)) {
                                content = response.builtInText;
                            }
                            if (!content) {
                                reject(new Error('File is not available as a custom or stock file on the server.'));
                            } else {
                                resolve(content);
                            }
                        } else {
                            reject(new Error(`Failed to download file: ${response.message || data}`));
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }
=======
>>>>>>> 25f6429057aac1ebbaf1ce01ec19e31c5958fbff:modules/tree-provider.js
    
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

            // Upload file (this method handles both create and update internally)
            const result = await this.psApi.uploadFileContent(treeItem.remotePath, content);

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
}

module.exports = { PowerSchoolTreeProvider, PowerSchoolTreeItem };