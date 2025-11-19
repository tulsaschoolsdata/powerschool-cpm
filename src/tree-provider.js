const vscode = require('vscode');
const fs = require('fs');
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
        const localPath = path.join(this.localRootPath, this.remotePath.replace(/^\/+/g, ''));
        const exists = fs.existsSync(localPath);
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
        const extensionPath = path.dirname(__filename.replace('/src', ''));
        
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
        this.localRootPath = localRootPath;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.treeCache = new Map();
        this.pluginMappings = null;  // Cache for plugin file mappings
        this.pluginFilePaths = null;  // Set of actual file paths (not folders)
        this.pluginMappingsLoaded = false;
        this.folderDecorations = new Map();  // Track folder decoration types by path
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
                const treeItems = this.createTreeItems(folderData.folder, folderPath);
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
    
    createTreeItems(folder, parentPath) {
        const items = [];
        const currentPath = parentPath === '/' ? '' : parentPath;
        
        // Create folder items
        if (folder.subFolders) {
            for (const subfolder of folder.subFolders) {
                const folderPath = `${currentPath}/${subfolder.text}`;
                const localUri = this.localRootPath ? 
                    vscode.Uri.file(path.join(this.localRootPath, folderPath.replace(/^\/+/g, ''))) : 
                    vscode.Uri.parse(`powerschool:${folderPath}`);
                
                // Check if this folder has any custom files (plugin or not)
                const hasCustomFiles = this.hasCustomFilesInFolder(folderPath);
                
                // Check if this is a plugin folder (folder contains plugin files)
                let pluginInfo = null;
                let isCustomFolder = false;
                
                // Check if any files in this folder are plugin files
                if (this.pluginMappings) {
                    for (const [filePath, plugin] of this.pluginMappings) {
                        if (filePath.startsWith(folderPath.toLowerCase() + '/')) {
                            pluginInfo = plugin;
                            isCustomFolder = true;
                            break;
                        }
                    }
                }
                
                const folderItem = new PowerSchoolTreeItem(
                    subfolder.text,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    localUri,
                    'folder',
                    folderPath,
                    this.psApi,
                    this.localRootPath,
                    isCustomFolder,
                    pluginInfo,
                    !!pluginInfo,
                    hasCustomFiles
                );
                
                items.push(folderItem);
            }
        }
        
        // Create file items
        if (folder.pages) {
            for (const page of folder.pages) {
                const filePath = `${currentPath}/${page.text}`;
                const localUri = this.localRootPath ? 
                    vscode.Uri.file(path.join(this.localRootPath, filePath.replace(/^\/+/g, ''))) : 
                    vscode.Uri.parse(`powerschool:${filePath}`);
                
                // Check if this file has plugin info
                const pluginInfo = this.getPluginInfoForPath(filePath);
                const isCustomFile = !!pluginInfo || this.isCustomFile(filePath);
                
                const fileItem = new PowerSchoolTreeItem(
                    page.text,
                    vscode.TreeItemCollapsibleState.None,
                    localUri,
                    'file',
                    filePath,
                    this.psApi,
                    this.localRootPath,
                    isCustomFile,
                    pluginInfo,
                    !!pluginInfo,
                    false // files don't have hasCustomFiles
                );
                
                items.push(fileItem);
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
        if (!treeItem || treeItem.contextValue !== 'file') {
            vscode.window.showErrorMessage('Invalid file selected.');
            return;
        }
        
        try {
            vscode.window.showInformationMessage(`Downloading ${treeItem.label}...`);
            
            const content = await this.psApi.downloadFileContent(treeItem.remotePath);
            
            if (!this.localRootPath) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            const localDir = path.dirname(localFilePath);
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            
            // Write file content
            fs.writeFileSync(localFilePath, content, 'utf8');
            
            // Open the file in editor
            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);
            
            vscode.window.showInformationMessage(`Downloaded ${treeItem.label} to ${path.relative(this.localRootPath, localFilePath)}`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to download ${treeItem.label}: ${error.message}`);
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
            
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            
            if (!fs.existsSync(localFilePath)) {
                vscode.window.showErrorMessage(`Local file not found: ${path.relative(this.localRootPath, localFilePath)}`);
                return;
            }
            
            const content = fs.readFileSync(localFilePath, 'utf8');
            
            vscode.window.showInformationMessage(`Publishing ${treeItem.label} to PowerSchool...`);
            
            const fileExists = await this.psApi.checkFileExists(treeItem.remotePath);
            
            if (fileExists) {
                await this.psApi.updateExistingFileContent(treeItem.remotePath, content);
            } else {
                await this.psApi.createNewFile(treeItem.remotePath, content);
            }
            
            // Verify the upload
            const verifiedContent = await this.psApi.verifyUpload(treeItem.remotePath);
            
            if (content === verifiedContent) {
                vscode.window.showInformationMessage(`Published ${treeItem.label} successfully!`);
            } else {
                vscode.window.showWarningMessage(`Published ${treeItem.label} but content verification failed.`);
            }
            
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
        const relativePath = path.relative(this.localRootPath, filePath);
        
        if (!relativePath || relativePath.startsWith('..')) {
            vscode.window.showWarningMessage('File is not in the current workspace.');
            return;
        }
        
        const remotePath = '/' + relativePath.replace(/\\/g, '/');
        
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