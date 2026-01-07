const vscode = require('vscode');
const https = require('https');
const pathUtils = require('./path-utils');
const path = require('path');

class PowerSchoolTreeItem extends vscode.TreeItem {
    constructor(label, collapsibleState, resourceUri, contextValue, remotePath, psApi, localRootPath, isCustom = false, pluginInfo = null, hasPluginInfo = false, hasCustomFiles = false) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.contextValue = contextValue;
        this.remotePath = remotePath;
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        this.isCustom = isCustom;
        this.pluginInfo = pluginInfo;  // { pluginId, pluginName, enabled }
        this.hasPluginInfo = hasPluginInfo; // Whether this item has plugin info (direct or inherited)
        this.hasCustomFiles = hasCustomFiles; // Whether this folder contains any custom files

        // Update contextValue to include custom and plugin status
        if (isCustom && pluginInfo) {
            this.contextValue = contextValue === 'file' ? 'file-custom-plugin' : 'folder-custom-plugin';
        } else if (isCustom) {
            this.contextValue = contextValue === 'file' ? 'file-custom' : 'folder-custom';
        }

        if (contextValue === 'file') {
            this.command = {
                command: 'ps-vscode-cpm.downloadFile',
                title: 'Download File',
                arguments: [this]
            };
            this.iconPath = this.getFileIcon();
            
            // Override resourceUri for FILES to enable colored icons
            if (isCustom && pluginInfo) {
                this.resourceUri = vscode.Uri.parse(`plugin:${label}`);
            } else if (isCustom) {
                this.resourceUri = vscode.Uri.parse(`custom:${label}`);
            }
        } else {
            // For FOLDERS, keep the file-based resourceUri so FileDecorationProvider can work
            this.iconPath = this.getFolderIcon();
            // Don't override resourceUri - it's already set from the constructor parameter
        }

        // Enhanced tooltip with custom status and plugin info
        let customStatus = '';
        let descriptionText = '';
        if (isCustom && pluginInfo) {
            const enabledStatus = pluginInfo.enabled ? '' : ' (Disabled)';
            customStatus = ` (Plugin: ${pluginInfo.pluginName}${enabledStatus})`;
            descriptionText = `● ${pluginInfo.pluginName}`;
        } else if (isCustom) {
            customStatus = ' (Custom - No Plugin)';
            descriptionText = '● custom';
        } else {
            customStatus = ' (Original PowerSchool)';
        }

        this.tooltip = contextValue === 'file' ? 
            `${label}${customStatus}\nClick to download from PowerSchool` :
            `${label}${customStatus}`;
        
        // Don't set description for folders - keep folder names clean
        // Plugin info will only show in tooltip on hover
    }
    
    getFileIcon() {
        const localPath = pathUtils.getLocalFilePathFromRemote(this.remotePath, this.localRootPath);
        const exists = require('fs').existsSync(localPath);
        // Plugin-controlled custom files get purple/magenta color
        if (this.isCustom && this.pluginInfo) {
            if (exists) {
                // Plugin file, downloaded locally - purple
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.interfaceForeground'));
            } else {
                // Plugin file, not downloaded - magenta
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('editorInfo.foreground'));
            }
        }
        // Non-plugin custom files get blue/orange color
        else if (this.isCustom) {
            if (exists) {
                // Custom file (no plugin), downloaded locally - blue
                return new vscode.ThemeIcon('file', new vscode.ThemeColor('symbolIcon.classForeground'));
            } else {
                // Custom file (no plugin), not downloaded - orange
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
        
        // Plugin folders - purple icon
        if (this.isCustom && this.pluginInfo) {
            return path.join(extensionPath, 'resources', 'icons', 'folder-plugin.svg');
        }
        // Stock folders with any custom files (plugin or not) - orange icon
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
        this.localRootPath = pathUtils.getPluginFilesRoot(localRootPath);
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
            this.localRootPath = pathUtils.getPluginFilesRoot(newRootPath);
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
        if (this.pluginMappingsLoaded) {
            return this.pluginMappings;
        }
        
        try {
            const mappings = await this.psApi.getPluginFileMappings();
            this.pluginMappings = new Map();
            this.pluginFilePaths = new Set();  // Track actual file paths
            
            // Build a map of file path to plugin info
            for (const mapping of mappings) {
                if (mapping.cpmpath && mapping.filename && mapping.pluginname) {
                    const fullPath = `${mapping.cpmpath}/${mapping.filename}`.toLowerCase();
                    const folderPath = mapping.cpmpath.toLowerCase();
                    
                    // Store plugin info for files
                    this.pluginMappings.set(fullPath, {
                        pluginId: mapping.pluginid,
                        pluginName: mapping.pluginname,
                        enabled: mapping.enabled === 'true' || mapping.enabled === true
                    });
                    
                    // Track that this is an actual file path (not folder)
                    this.pluginFilePaths.add(fullPath);
                    
                    // Mark folder as plugin folder in decorations
                    this.folderDecorations.set(folderPath, 'plugin');
                }
            }
            
            this.pluginMappingsLoaded = true;
            return this.pluginMappings;
        } catch (error) {
            this.pluginMappingsLoaded = true; // Don't keep retrying on error
            this.pluginMappings = new Map();
            this.pluginFilePaths = new Set();
            return this.pluginMappings;
        }
    }
    
    getPluginInfoForPath(remotePath) {
        if (!this.pluginMappings) {
            return null;
        }
        
        const normalizedPath = remotePath.toLowerCase();
        return this.pluginMappings.get(normalizedPath) || null;
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
                const treeItems = await this.createTreeItems(folderData.folder, folderPath, null);
                children.push(...treeItems);
            }
            
            // Cache the results
            this.treeCache.set(folderPath, children);
            return children;
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to load folder ${folderPath}: ${error.message}`);
            return [];
        }
    }
    
    async createTreeItems(folderData, currentPath, parentPluginInfo = null) {
        const items = [];
        let hasCustomFiles = false;

        // Load plugin mappings if not already loaded
        const pluginMappings = await this.loadPluginMappings();
        const normalizedCurrentPath = currentPath.toLowerCase();

        // Sort subfolders alphabetically and add to items
        if (folderData.subFolders) {
            const sortedSubfolders = [...folderData.subFolders].sort((a, b) =>
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );

            for (const subfolder of sortedSubfolders) {
                const folderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                const normalizedPath = folderPath.toLowerCase();
                // Only use plugin info for CUSTOM items
                let effectivePluginInfo = null;
                if (subfolder.custom) {
                    const directPluginInfo = pluginMappings.get(normalizedPath) || null;
                    effectivePluginInfo = directPluginInfo || parentPluginInfo;
                }
                // Recursively get subfolder items and check if any are custom
                const subfolderTree = await this.createTreeItems(subfolder, folderPath, effectivePluginInfo);
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
                    effectivePluginInfo,
                    effectivePluginInfo !== null,
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
                const normalizedPath = filePath.toLowerCase();
                let effectivePluginInfo = null;
                if (page.custom) {
                    const directPluginInfo = pluginMappings.get(normalizedPath) || null;
                    effectivePluginInfo = directPluginInfo || parentPluginInfo;
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
                    page.custom,
                    effectivePluginInfo,
                    effectivePluginInfo !== null
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
        // For now, just check plugin mappings
        // Could be extended to check other custom file indicators
        return this.getPluginInfoForPath(filePath) !== null;
    }
    
    async downloadFile(treeItem) {
        try {
            const localFilePath = pathUtils.getLocalFilePathFromRemote(treeItem.remotePath, this.localRootPath);
            const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
            const warningMsg = `This will create the following file and folders on your local system:\n${relativeLocalPath}\n\nContinue?`;
            const confirm = await vscode.window.showWarningMessage(warningMsg, { modal: true }, 'Yes');
            if (confirm !== 'Yes') {
                return { success: false, message: 'User cancelled download.' };
            }

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