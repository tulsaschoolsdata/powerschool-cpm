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
        // Always resolve localRootPath using pathUtils.getPluginFilesRoot
        this.localRootPath = pathUtils.getPluginFilesRoot();
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.treeCache = new Map();
        this.pluginMappings = null;  // Cache for plugin file mappings
        this.pluginFilePaths = null;  // Set of actual file paths (not folders)
        this.pluginMappingsLoaded = false;
        this.folderDecorations = new Map();  // Track folder decoration types by path
    }
        setLocalRootPath(newRootPath) {
            // Always resolve using pathUtils.getPluginFilesRoot
            this.localRootPath = pathUtils.getPluginFilesRoot();
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
    
    async loadPluginMappings() {
        // Note: We don't load plugin mappings from PowerQuery anymore.
        // Custom files are detected from the tree data itself (page.custom flag)
        // This method exists for compatibility but doesn't do anything now.
        if (this.pluginMappingsLoaded) {
            return this.pluginMappings;
        }
        
        // Initialize empty maps - custom file detection happens in createTreeItems
        this.pluginMappings = new Map();
        this.pluginFilePaths = new Set();
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
            console.log('[TREE] 📦 Returning cached children for', folderPath);
            return this.treeCache.get(folderPath);
        }
        
        try {
            console.log('[TREE] 🌳 Loading folder:', folderPath);
            // Load plugin mappings if not already loaded
            await this.loadPluginMappings();
            
            // Get folder contents from PowerSchool
            console.log('[TREE] 📡 Calling psApi.getFolderTree...');
            const folderData = await this.psApi.getFolderTree(folderPath, 1);
            const children = [];
            
            if (folderData.folder) {
                // Create tree items for subfolders and files
                const treeItems = await this.createTreeItems(folderData.folder, folderPath);
                children.push(...treeItems);
            }
            
            // Cache the results
            this.treeCache.set(folderPath, children);
            console.log('[TREE] ✅ Loaded', children.length, 'items for', folderPath);
            return children;
            
        } catch (error) {
            console.error('[TREE] ❌ Error loading folder', folderPath, ':', error.message);
            vscode.window.showErrorMessage(`Failed to load folder ${folderPath}: ${error.message}`);
            return [];
        }
    }
    
    async createTreeItems(folderData, currentPath) {
        const items = [];
        let hasCustomFiles = false;

        // Load plugin mappings if not already loaded (now just initializes empty maps)
        await this.loadPluginMappings();

        // Sort subfolders alphabetically and add to items
        if (folderData.subFolders) {
            const sortedSubfolders = [...folderData.subFolders].sort((a, b) =>
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );

            for (const subfolder of sortedSubfolders) {
                const folderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                // Recursively get subfolder items and check if any are custom
                const subfolderTree = await this.createTreeItems(subfolder, folderPath);
                const subfolderHasCustom = subfolderTree.some(child => child.isCustom || child.hasCustomFiles);
                if (subfolderHasCustom) hasCustomFiles = true;
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
            const sortedPages = [...folderData.pages].sort((a, b) =>
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );

            for (const page of sortedPages) {
                const filePath = currentPath === '/' ? `/${page.text}` : `${currentPath}/${page.text}`;
                if (page.custom) {
                    hasCustomFiles = true;
                }
                const item = new PowerSchoolTreeItem(
                    page.text,
                    vscode.TreeItemCollapsibleState.None,
                    null,
                    'file',
                    filePath,
                    this.psApi,
                    this.localRootPath,
                    page.custom
                );
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
            console.log(`📥 Downloading: ${treeItem.remotePath}`);
            console.log(`   Plugin files root: ${this.localRootPath}`);
            console.log(`   Target file path: ${localFilePath}`);

            await pathUtils.ensureLocalDir(localFilePath);
            vscode.window.showInformationMessage(`Downloading ${treeItem.label}...`);

            const fileContent = await this.downloadFileContent(treeItem.remotePath);
            const fileExists = require('fs').existsSync(localFilePath);
            console.log(`   File ${fileExists ? 'EXISTS' : 'NEW'}: ${localFilePath}`);

            pathUtils.writeFile(localFilePath, fileContent);

            console.log(`✅ Downloaded: ${treeItem.remotePath}`);
            const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
            vscode.window.showInformationMessage(
                `${fileExists ? 'Updated' : 'Downloaded'} ${treeItem.label} to ${relativeLocalPath}`
            );

            this._onDidChangeTreeData.fire(treeItem);

            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);

            // Immediately cache customContentId after download (for fast publish)
            try {
                await this.psApi.downloadFileInfo(treeItem.remotePath);
                console.log(`💾 Cached customContentId for ${treeItem.remotePath} after download`);
            } catch (err) {
                console.warn(`⚠️ Could not cache customContentId for ${treeItem.remotePath} after download:`, err.message);
            }
            return { success: true };
        } catch (error) {
            console.error(`❌ Failed to download ${treeItem.remotePath}:`, error);
            vscode.window.showErrorMessage(`Failed to download ${treeItem.label}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    async downloadFileContent(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false', // Keep downloads fast - cache will be populated by file save watcher
            path: filePath
        });
        
        const endpoint = '/ws/cpm/builtintext';
        await this.psApi.ensureAuthenticated(endpoint);
        
        const options = {
            hostname: new URL(this.psApi.baseUrl).hostname,
            port: 443,
            path: `${endpoint}?${queryParams.toString()}`,
            method: 'GET',
            rejectUnauthorized: false, // Accept self-signed certificates
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
                            // Note: With LoadFolderInfo='false', we don't get customContentId here
                            // The file save watcher will cache it after the file is saved locally
                            const content = response.activeCustomText || response.builtInText || '';
                            resolve(content);
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
    
    async publishFile(treeItem) {
        console.log('📤 publishFile called with treeItem:', treeItem ? treeItem.label : 'null');

        if (!treeItem || treeItem.contextValue !== 'file') {
            console.log('❌ Invalid file selected - contextValue:', treeItem ? treeItem.contextValue : 'null');
            vscode.window.showErrorMessage('Invalid file selected.');
            return;
        }

        console.log('📤 Publishing file:', treeItem.label, 'remotePath:', treeItem.remotePath);

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

            console.log('✅ Upload complete, result:', result);
            vscode.window.showInformationMessage(`✅ Published ${treeItem.label} successfully!`);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to publish ${treeItem.label}: ${error.message}`);
        }
    }
    
    async publishCurrentFile() {
        console.log('📤 publishCurrentFile called');

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            console.log('❌ No active editor');
            vscode.window.showWarningMessage('No active file to publish.');
            return;
        }

        if (!this.localRootPath) {
            console.log('❌ No localRootPath set on tree provider');
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