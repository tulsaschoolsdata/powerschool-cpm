const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getTemplatesByCategory, getTemplate } = require('./templates');
const { getSnippetsByCategory } = require('./code_snippets');
const { PowerSchoolAPI } = require('./src/powerschool-api');

// Helper function to find first difference between two strings
function findFirstDifference(str1, str2) {
    const minLength = Math.min(str1.length, str2.length);
    for (let i = 0; i < minLength; i++) {
        if (str1[i] !== str2[i]) {
            return i;
        }
    }
    return minLength; // Strings are identical up to the shorter length
}

// Helper function to generate multipart form data
function generateMultipartData(fields, boundary) {
    let data = '';
    for (const [name, value] of Object.entries(fields)) {
        data += `--${boundary}\r\n`;
        data += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
        data += `${value}\r\n`;
    }
    data += `--${boundary}--\r\n`;
    return data;
}



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
        const extensionPath = path.dirname(__filename);
        
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
                    
                    const pluginData = {
                        pluginId: mapping.pluginid,
                        pluginName: mapping.pluginname,
                        enabled: mapping.enabled === '1' || mapping.enabled === 1 || mapping.enabled === true
                    };
                    
                    // Map the full file path and track it as an actual file
                    this.pluginMappings.set(fullPath, pluginData);
                    this.pluginFilePaths.add(fullPath);  // Mark as actual file
                    
                    // Map the immediate folder path
                    if (!this.pluginMappings.has(folderPath)) {
                        this.pluginMappings.set(folderPath, pluginData);
                    }
                    
                    // Map ALL parent folder paths (e.g., /admin/META for /admin/META/dat_reference)
                    const pathParts = folderPath.split('/').filter(p => p);
                    let currentPath = '';
                    for (const part of pathParts) {
                        currentPath += '/' + part;
                        if (!this.pluginMappings.has(currentPath)) {
                            this.pluginMappings.set(currentPath, pluginData);
                        }
                    }
                }
            }
            
            this.pluginMappingsLoaded = true;
            return this.pluginMappings;
        } catch (error) {
            console.warn(`⚠️  Failed to load plugin mappings: ${error.message}`);
            this.pluginMappings = new Map();
            this.pluginMappingsLoaded = true;
            return this.pluginMappings;
        }
    }
    
    getTreeItem(element) {
        return element;
    }
    
    async getChildren(element) {
        try {
            // Check if workspace is available
            if (!this.localRootPath) {
                console.log('⚠️ No workspace root path');
                return [{
                    label: 'No workspace open',
                    description: 'Please open a folder to browse PowerSchool files',
                    contextValue: 'placeholder',
                    iconPath: new vscode.ThemeIcon('folder-opened'),
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }];
            }

            // Check if PowerSchool credentials are configured
            const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
            const serverUrl = config.get('serverUrl');
            const authMethod = config.get('authMethod') || 'oauth';
            const clientId = config.get('clientId');
            const clientSecret = config.get('clientSecret');
            const username = config.get('username');
            const password = config.get('password');
            
            const hasOAuth = serverUrl && clientId && clientSecret;
            const hasSession = serverUrl && username && password;
            
            let missingItems = [];
            let isConfigured = false;
            
            if (authMethod === 'oauth') {
                isConfigured = hasOAuth;
                if (!serverUrl) missingItems.push('Server URL');
                if (!clientId) missingItems.push('Client ID');
                if (!clientSecret) missingItems.push('Client Secret');
            } else if (authMethod === 'session') {
                isConfigured = hasSession;
                if (!serverUrl) missingItems.push('Server URL');
                if (!username) missingItems.push('Username');
                if (!password) missingItems.push('Password');
            } else if (authMethod === 'hybrid') {
                isConfigured = hasOAuth || hasSession; // Need at least one method
                if (!serverUrl) missingItems.push('Server URL');
                if (!hasOAuth) missingItems.push('OAuth credentials (Client ID/Secret)');
                if (!hasSession) missingItems.push('Session credentials (Username/Password)');
            }
            
            if (!isConfigured) {
                return [{
                    label: `PowerSchool ${authMethod} not configured`,
                    description: `Missing: ${missingItems.join(', ')}. Click settings icon to configure.`,
                    contextValue: 'not-configured',
                    iconPath: new vscode.ThemeIcon('settings-gear'),
                    collapsibleState: vscode.TreeItemCollapsibleState.None
                }];
            }
            
            if (!element) {
                console.log('📡 Loading PowerSchool file tree...');
                const rootTree = await this.psApi.getFolderTree('/', 1);
                
                if (rootTree.folder) {
                    return await this.createTreeItems(rootTree.folder, '/', null);
                }
                return [];
            } else if (element.contextValue === 'folder' || element.contextValue === 'folder-custom' || element.contextValue === 'folder-custom-plugin') {
                // Include pluginInfo in cache key to ensure different versions are cached separately
                const pluginKey = element.pluginInfo ? element.pluginInfo.pluginName : 'none';
                const cacheKey = `${element.remotePath}:${pluginKey}`;
                
                if (this.treeCache.has(cacheKey)) {
                    return this.treeCache.get(cacheKey);
                }
                
                const folderTree = await this.psApi.getFolderTree(element.remotePath, 1);
                
                if (folderTree.folder) {
                    // Only pass plugin info to children if this folder is actually custom
                    // Stock folders should not propagate plugin info to their children
                    const pluginInfoToPass = element.isCustom ? element.pluginInfo : null;
                    const items = await this.createTreeItems(folderTree.folder, element.remotePath, pluginInfoToPass);
                    this.treeCache.set(cacheKey, items);
                    return items;
                }
                return [];
            }
            return [];
        } catch (error) {
            console.error('Error loading tree data:', error);
            vscode.window.showErrorMessage(`Failed to load PowerSchool data: ${error.message}`);
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
    
    async downloadFile(treeItem) {
        try {
            // Create local path that mirrors PowerSchool structure within the plugin files root
            // this.localRootPath already points to web_root if it exists, or workspace root otherwise
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            
            console.log(`📥 Downloading: ${treeItem.remotePath}`);
            console.log(`   Plugin files root: ${this.localRootPath}`);
            console.log(`   Target file path: ${localFilePath}`);
            
            const localDir = path.dirname(localFilePath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
                console.log(`📁 Created directory: ${localDir}`);
            } else {
                console.log(`📁 Directory exists: ${localDir}`);
            }
            
            vscode.window.showInformationMessage(`Downloading ${treeItem.label}...`);
            
            const fileContent = await this.downloadFileContent(treeItem.remotePath);
            
            // Check if file already exists
            const fileExists = fs.existsSync(localFilePath);
            console.log(`   File ${fileExists ? 'EXISTS' : 'NEW'}: ${localFilePath}`);
            
            fs.writeFileSync(localFilePath, fileContent);
            
            console.log(`✅ Downloaded: ${treeItem.remotePath}`);
            const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
            vscode.window.showInformationMessage(
                `${fileExists ? 'Updated' : 'Downloaded'} ${treeItem.label} to ${relativeLocalPath}`
            );
            
            this._onDidChangeTreeData.fire(treeItem);
            
            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);
            
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
        try {
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            
            if (!fs.existsSync(localFilePath)) {
                vscode.window.showErrorMessage(`Local file not found: ${treeItem.label}. Please download it first.`);
                return { success: false, message: 'File not found locally' };
            }
            
            console.log(`📤 Publishing: ${treeItem.remotePath}`);
            vscode.window.showInformationMessage(`Publishing ${treeItem.label} to PowerSchool...`);
            
            const fileContent = fs.readFileSync(localFilePath, 'utf8');
            console.log(`📄 Local file content (${fileContent.length} chars): ${fileContent.substring(0, 200)}...`);
            
            // Upload the file
            const uploadResult = await this.psApi.uploadFileContent(treeItem.remotePath, fileContent);
            
            // Verify the upload by re-downloading
            vscode.window.showInformationMessage(`Verifying upload of ${treeItem.label}...`);
            const verifiedContent = await this.psApi.verifyUpload(treeItem.remotePath);
            
            // Compare content
            const uploadSuccessful = fileContent === verifiedContent;
            
            if (uploadSuccessful) {
                console.log(`✅ Published and verified: ${treeItem.remotePath}`);
                vscode.window.showInformationMessage(`Published ${treeItem.label} successfully! Content verified.`);
            } else {
                console.log(`⚠️  Upload completed but verification shows different content`);
                console.log(`   Original length: ${fileContent.length}`);
                console.log(`   Verified length: ${verifiedContent.length}`);
                console.log(`   First difference at char: ${findFirstDifference(fileContent, verifiedContent)}`);
                vscode.window.showWarningMessage(`Published ${treeItem.label} but content verification failed. Check console for details.`);
            }
            
            return { success: true, verified: uploadSuccessful, uploadResult };
        } catch (error) {
            console.error(`❌ Failed to publish ${treeItem.remotePath}:`, error);
            vscode.window.showErrorMessage(`Failed to publish ${treeItem.label}: ${error.message}`);
            return { success: false, message: error.message };
        }
    }

    async publishCurrentFile() {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active file to publish.');
                return { success: false, message: 'No active file' };
            }
            
            const filePath = activeEditor.document.fileName;
            const relativePath = path.relative(this.localRootPath, filePath);
            
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showWarningMessage('File is not in the current workspace. Only files within the workspace can be published.');
                return { success: false, message: 'File not in workspace' };
            }
            
            // Convert local path to PowerSchool path format
            const remotePath = '/' + relativePath.replace(/\\/g, '/');
            
            console.log(`📤 Publishing current file: ${remotePath}`);
            vscode.window.showInformationMessage(`Publishing ${path.basename(filePath)} to PowerSchool...`);
            
            // Save the file first if it has unsaved changes
            if (activeEditor.document.isDirty) {
                await activeEditor.document.save();
            }
            
            const fileContent = fs.readFileSync(filePath, 'utf8');
            console.log(`📄 Publishing file content (${fileContent.length} chars): ${fileContent.substring(0, 200)}...`);
            
            console.log('🚨 ABOUT TO CALL uploadFileContent with remotePath:', remotePath);
            console.log('🚨 PowerSchool API auth method:', this.psApi.authMethod);
            
            // Upload the file
            const uploadResult = await this.psApi.uploadFileContent(remotePath, fileContent);
            
            // Verify the upload
            vscode.window.showInformationMessage(`Verifying upload of ${path.basename(filePath)}...`);
            const verifiedContent = await this.psApi.verifyUpload(remotePath);
            
            // Compare content
            const uploadSuccessful = fileContent === verifiedContent;
            
            if (uploadSuccessful) {
                console.log(`✅ Published and verified: ${remotePath}`);
                vscode.window.showInformationMessage(`Published ${path.basename(filePath)} successfully! Content verified.`);
            } else {
                console.log(`⚠️  Upload completed but verification shows different content`);
                console.log(`   Original length: ${fileContent.length}`);
                console.log(`   Verified length: ${verifiedContent.length}`);
                console.log(`   First difference at char: ${findFirstDifference(fileContent, verifiedContent)}`);
                vscode.window.showWarningMessage(`Published ${path.basename(filePath)} but content verification failed. Check console for details.`);
            }
            
            return { success: true, verified: uploadSuccessful, uploadResult };
        } catch (error) {
            console.error(`❌ Failed to publish current file:`, error);
            vscode.window.showErrorMessage(`Failed to publish file: ${error.message}`);
            return { success: false, message: error.message };
        }
    }
}

// Helper function to get the actual root path for PowerSchool plugin files
// 1. If pluginWebRoot setting is blank, auto-detect web_root folder
// 2. If web_root folder exists, use it as the base for all file operations
// 3. Otherwise fall back to workspace root
function getPluginFilesRoot(workspaceRoot) {
    if (!workspaceRoot) return null;
    const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
    let pluginRootPath = config.get('pluginWebRoot');
    
    // If setting is blank or not configured, auto-detect web_root
    if (!pluginRootPath || pluginRootPath.trim() === '') {
        const webRootPath = path.join(workspaceRoot, 'web_root');
        if (fs.existsSync(webRootPath) && fs.statSync(webRootPath).isDirectory()) {
            console.log(`✅ Auto-detected web_root directory: ${webRootPath}`);
            return webRootPath;
        }
        console.log(`📁 No web_root found, using workspace root: ${workspaceRoot}`);
        return workspaceRoot;
    }
    
    // If setting is configured, use that path
    const fullPluginRoot = path.join(workspaceRoot, pluginRootPath);
    if (fs.existsSync(fullPluginRoot) && fs.statSync(fullPluginRoot).isDirectory()) {
        console.log(`✅ Found configured plugin root: ${fullPluginRoot}`);
        return fullPluginRoot;
    }
    console.warn(`⚠️  Configured plugin root not found: ${fullPluginRoot}`);
    console.warn(`⚠️  Falling back to workspace root`);
    return workspaceRoot;
}

function getPluginXmlPath(workspaceRoot) {
    const pluginRoot = getPluginFilesRoot(workspaceRoot);
    return path.join(pluginRoot, 'plugin.xml');
}

// Helper function to parse version from plugin.xml
function parsePluginVersion(pluginXmlPath) {
    try {
        const xmlContent = fs.readFileSync(pluginXmlPath, 'utf8');
        const versionMatch = xmlContent.match(/version="([^"]+)"/);
        if (versionMatch) {
            return versionMatch[1];
        }
    } catch (error) {
        console.error('Failed to parse plugin version:', error);
    }
    return '1.0.0';
}

// Helper function to update version in plugin.xml
function updatePluginVersion(pluginXmlPath, newVersion) {
    try {
        let xmlContent = fs.readFileSync(pluginXmlPath, 'utf8');
        xmlContent = xmlContent.replace(/version="[^"]+"/, `version="${newVersion}"`);
        fs.writeFileSync(pluginXmlPath, xmlContent, 'utf8');
        return true;
    } catch (error) {
        console.error('Failed to update plugin version:', error);
        return false;
    }
}

// Helper function to increment semantic version
function incrementVersion(version, type) {
    const parts = version.split('.').map(n => parseInt(n) || 0);
    while (parts.length < 3) parts.push(0);
    
    switch (type) {
        case 'major':
            parts[0]++;
            parts[1] = 0;
            parts[2] = 0;
            break;
        case 'minor':
            parts[1]++;
            parts[2] = 0;
            break;
        case 'patch':
            parts[2]++;
            break;
    }
    
    return parts.join('.');
}

// Helper function to create ZIP file using native zip command
async function createPluginZip(workspaceRoot, pluginName, version, dirsToInclude) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    const zipFileName = `${pluginName}-${version}.zip`;
    const zipFilePath = path.join(workspaceRoot, zipFileName);
    
    // Remove old zip if exists
    if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
    }
    
    // Build list of items to include
    const itemsToZip = ['plugin.xml', ...dirsToInclude].filter(item => {
        const itemPath = path.join(workspaceRoot, item);
        return fs.existsSync(itemPath);
    });
    
    if (itemsToZip.length === 0) {
        throw new Error('No items found to package. Ensure plugin.xml and directories exist.');
    }
    
    // Create zip using native zip command
    const zipCommand = `cd "${workspaceRoot}" && zip -r "${zipFileName}" ${itemsToZip.map(i => `"${i}"`).join(' ')}`;
    
    try {
        await execAsync(zipCommand);
        return zipFilePath;
    } catch (error) {
        throw new Error(`Failed to create ZIP file: ${error.message}`);
    }
}

function activate(context) {
    // Get workspace folder - use the first workspace folder as root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let workspaceRootPath = null;
    let pluginFilesRoot = null;
    
    if (workspaceFolders && workspaceFolders.length > 0) {
        workspaceRootPath = workspaceFolders[0].uri.fsPath;
        pluginFilesRoot = getPluginFilesRoot(workspaceRootPath);
    }

    // Initialize PowerSchool API and Tree Provider
    const api = new PowerSchoolAPI();
    api.initialize(); // Load configuration from VS Code settings
    const treeProvider = new PowerSchoolTreeProvider(api, pluginFilesRoot);
    
    // Store globally for cleanup
    global.powerschoolCpmTreeProvider = treeProvider;

    // Watch for workspace changes to update the tree provider
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let newWorkspaceRootPath = null;
        let newPluginFilesRoot = null;
        
        if (workspaceFolders && workspaceFolders.length > 0) {
            newWorkspaceRootPath = workspaceFolders[0].uri.fsPath;
            newPluginFilesRoot = getPluginFilesRoot(newWorkspaceRootPath);
        }
        
        treeProvider.localRootPath = newPluginFilesRoot;
        treeProvider.refresh();
    });

    // Watch for configuration changes to update API settings
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ps-vscode-cpm')) {
            // Clear authentication and reload configuration
            api.clearAuth();
            api.initialize(); // Reload configuration from VS Code settings
            
            // Check if web_root path changed
            if (e.affectsConfiguration('ps-vscode-cpm.pluginWebRoot')) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const newPluginFilesRoot = getPluginFilesRoot(workspaceFolders[0].uri.fsPath);
                    treeProvider.localRootPath = newPluginFilesRoot;
                }
            }
            
            // Refresh the tree to apply new settings
            treeProvider.refresh();
        }
    });

    // Check if tree view already exists and dispose it
    if (global.powerschoolCpmTreeView) {
        try {
            global.powerschoolCpmTreeView.dispose();
        } catch (error) {
            console.warn('Error disposing previous tree view:', error.message);
        }
        global.powerschoolCpmTreeView = null;
    }
    
    // Register the tree view with error handling
    let treeView;
    try {
        treeView = vscode.window.createTreeView('ps-vscode-cpm-explorer', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });
        
        // Store globally for cleanup
        global.powerschoolCpmTreeView = treeView;
        
        // Register file decoration provider to color file/folder labels
        const fileDecorator = vscode.window.registerFileDecorationProvider({
            provideFileDecoration(uri) {
                // Diagnostic logging for every decoration call
                const fileName = uri.path.split('/').pop();
                console.log(`[DECORATOR] uri='${uri.toString()}' scheme='${uri.scheme}' path='${uri.path}' fileName='${fileName}'`);

                // Always color .txt files green (should only apply to files)
                if (fileName && fileName.endsWith('.txt')) {
                    const result = {
                        color: new vscode.ThemeColor('charts.green'), // green
                        tooltip: 'Text File'
                    };
                    console.log(`[DECORATOR] .txt match: fileName='${fileName}', returning`, result);
                    return result;
                }

                // For custom URI schemes (files use this)
                if (uri.scheme === 'plugin') {
                    const result = {
                        color: new vscode.ThemeColor('symbolIcon.interfaceForeground'),
                        tooltip: 'Plugin File'
                    };
                    console.log('[DECORATOR] Returning PLUGIN decoration', result);
                    return result;
                } else if (uri.scheme === 'custom') {
                    const result = {
                        color: new vscode.ThemeColor('symbolIcon.classForeground'),
                        tooltip: 'Custom File'
                    };
                    console.log('[DECORATOR] Returning CUSTOM decoration', result);
                    return result;
                }

                // For folders with file:// scheme, check the decoration map
                if (uri.scheme === 'file' && treeProvider.folderDecorations && treeProvider.folderDecorations.size > 0) {
                    console.log(`[DECORATOR] Checking folderDecorations for uri.path='${uri.path}' (${treeProvider.folderDecorations.size} entries)`);
                    for (const [folderPath, decorationType] of treeProvider.folderDecorations) {
                        const normalizedFolderPath = folderPath.replace(/^\/+/g, '');
                        if (uri.path.endsWith(normalizedFolderPath)) {
                            let result;
                            if (decorationType === 'plugin') {
                                result = {
                                    color: new vscode.ThemeColor('symbolIcon.interfaceForeground'),
                                    tooltip: 'Plugin Folder'
                                };
                            } else if (decorationType === 'custom') {
                                result = {
                                    color: new vscode.ThemeColor('symbolIcon.classForeground'),
                                    tooltip: 'Custom Folder'
                                };
                            }
                            if (result) {
                                console.log(`[DECORATOR] FOLDER MATCH: ${folderPath} → ${decorationType}, returning`, result);
                                return result;
                            }
                        }
                    }
                    console.log('[DECORATOR] No match found in folderDecorations, returning undefined');
                }

                console.log('[DECORATOR] No decoration applied, returning undefined');
                return undefined;
            }
        });
        context.subscriptions.push(fileDecorator);
        console.log('🎨 File decoration provider registered for custom and plugin files');
        
    } catch (error) {
        console.error('❌ Failed to create tree view ps-vscode-cpm-explorer:', error.message);
        vscode.window.showErrorMessage('PowerSchool CPM: Tree view registration failed. Please reload VS Code window (Cmd+Shift+P → "Developer: Reload Window").');
        return;
    }
    
    // Register commands with error handling for duplicates
    const registerCommandSafely = (commandId, callback) => {
        try {
            return vscode.commands.registerCommand(commandId, callback);
        } catch (error) {
            console.warn(`Command ${commandId} already registered:`, error.message);
            return { dispose: () => {} }; // Mock disposable
        }
    };
    
    const refreshCommand = registerCommandSafely('ps-vscode-cpm.refresh', () => {
        // Clear any cached authentication
        api.clearAuth();
        
        // Refresh the tree provider
        treeProvider.refresh();
        
        vscode.window.showInformationMessage('PowerSchool connection refreshed! Tree will reload with new settings.');
    });

    const testConnectionCommand = registerCommandSafely('ps-vscode-cpm.testConnection', async () => {
        try {
            vscode.window.showInformationMessage('🧪 Testing PowerSchool OAuth connection and CPM API access...');
            const results = await api.testOAuthConnection();
            
            // Create detailed results message
            let message = '📊 Connection Test Results:\n\n';
            message += `✅ Basic API: ${results.basicAPI.success ? 'Working' : 'Failed'}\n`;
            message += `${results.cpmTree.success ? '✅' : '❌'} CPM Tree: ${results.cpmTree.success ? 'Working' : `Failed (${results.cpmTree.status})`}\n`;
            
            if (results.basicAPI.success && !results.cpmTree.success) {
                message += '\n🔍 OAuth is working but CPM APIs are not accessible.\nThis suggests CPM endpoints may not support OAuth authentication.';
            } else if (results.basicAPI.success && results.cpmTree.success) {
                message += '\n🎉 Both basic API and CPM APIs are working!';
            }
            
            if (results.basicAPI.success) {
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showErrorMessage('❌ OAuth authentication failed. Check your credentials and server URL.');
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`❌ Connection test failed: ${error.message}`);
        }
    });
    
    const downloadCommand = registerCommandSafely('ps-vscode-cpm.downloadFile', async (treeItem) => {
        await treeProvider.downloadFile(treeItem);
    });
    
    const publishCommand = registerCommandSafely('ps-vscode-cpm.publishFile', async (treeItem) => {
        await treeProvider.publishFile(treeItem);
    });
    
    const publishCurrentCommand = registerCommandSafely('ps-vscode-cpm.publishCurrentFile', async () => {
        await treeProvider.publishCurrentFile();
    });
    
    const showCurrentFilePathCommand = registerCommandSafely('ps-vscode-cpm.showCurrentFilePath', async () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showInformationMessage('No file is currently open.');
                return;
            }
            
            const filePath = activeEditor.document.fileName;
            const workspaceRoot = global.powerschoolCpmTreeProvider?.localRootPath;
            
            if (!workspaceRoot) {
                vscode.window.showInformationMessage('No workspace folder is open.');
                return;
            }
            
            const relativePath = path.relative(workspaceRoot, filePath);
            
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showInformationMessage(
                    `📄 Current file: ${path.basename(filePath)}\n` +
                    `⚠️  This file is outside the workspace.\n` +
                    `Files must be inside the workspace to sync with PowerSchool.`
                );
                return;
            }
            
            // Convert to PowerSchool path
            const powerSchoolPath = '/' + relativePath.replace(/\\/g, '/');
            
            // Get info about web_root configuration
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const actualWorkspaceRoot = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : null;
            const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
            const webRootSubdir = config.get('pluginWebRoot') || 'web_root';
            const isInWebRoot = actualWorkspaceRoot && workspaceRoot !== actualWorkspaceRoot;
            
            let message = `📄 Local file: ${relativePath}\n` +
                `🔗 PowerSchool path: ${powerSchoolPath}\n\n`;
            
            if (isInWebRoot) {
                message += `📂 Plugin structure: workspace/${webRootSubdir}/${relativePath}\n` +
                    `This matches PowerSchool plugin web_root structure.\n`;
            } else {
                message += `This file syncs with PowerSchool at the path shown above.\n`;
            }
            
            const choice = await vscode.window.showInformationMessage(
                message,
                'Copy PowerSchool Path',
                'OK'
            );
            
            if (choice === 'Copy PowerSchool Path') {
                await vscode.env.clipboard.writeText(powerSchoolPath);
                vscode.window.showInformationMessage(`Copied: ${powerSchoolPath}`);
            }
            
        } catch (error) {
            console.error('Failed to show file path:', error);
            vscode.window.showErrorMessage(`Failed to show file path: ${error.message}`);
        }
    });
    
    const createNewFileCommand = registerCommandSafely('ps-vscode-cpm.createNewFile', async () => {
        try {
            // Get templates organized by category
            const templatesByCategory = getTemplatesByCategory();
            
            // Create organized template options with category separators
            const templateOptions = [];
            
            Object.keys(templatesByCategory).forEach(category => {
                // Add category header
                templateOptions.push({
                    label: `── ${category} Templates ──`,
                    description: '',
                    kind: vscode.QuickPickItemKind.Separator
                });
                
                // Add templates in this category
                templatesByCategory[category].forEach(template => {
                    templateOptions.push({
                        label: template.name,
                        description: template.description,
                        detail: `${template.extension} • ${category}`,
                        key: template.key
                    });
                });
            });
            
            const selectedTemplate = await vscode.window.showQuickPick(templateOptions, {
                placeHolder: 'Select the type of PowerSchool file to create',
                matchOnDescription: true,
                matchOnDetail: true
            });
            
            if (!selectedTemplate || !selectedTemplate.key) return;
            
            const template = getTemplate(selectedTemplate.key);
            if (!template) {
                vscode.window.showErrorMessage('Template not found');
                return;
            }
            
            // Get file name from user
            const fileName = await vscode.window.showInputBox({
                prompt: `Enter name for new ${selectedTemplate.label}`,
                placeHolder: `my-new-page${template.extension}`,
                validateInput: (value) => {
                    if (!value) return 'File name is required';
                    if (!value.endsWith(template.extension)) {
                        return `File name must end with ${template.extension}`;
                    }
                    return null;
                }
            });
            
            if (!fileName) return;
            
            // Get target directory - Ask first to help organize files properly
            const pathOptions = [
                { label: '/admin', description: 'Admin pages (general admin area)', path: '/admin' },
                { label: '/admin/students', description: 'Student-specific admin pages', path: '/admin/students' },
                { label: '/admin/teachers', description: 'Teacher-specific admin pages', path: '/admin/teachers' },
                { label: '/admin/schools', description: 'School admin pages', path: '/admin/schools' },
                { label: '/teachers', description: 'Teacher portal pages', path: '/teachers' },
                { label: '/guardian', description: 'Parent/Guardian portal pages', path: '/guardian' },
                { label: '/students', description: 'Student portal pages', path: '/students' },
                { label: '/public', description: 'Public pages (no auth required)', path: '/public' },
                { label: '/images/css', description: 'CSS stylesheets', path: '/images/css' },
                { label: '/images/javascript', description: 'JavaScript files', path: '/images/javascript' },
                { label: 'Browse existing folders...', description: 'Select from PowerSchool folders', browse: true },
                { label: 'Custom path...', description: 'Enter a custom PowerSchool path', custom: true }
            ];
            
            const selectedPath = await vscode.window.showQuickPick(pathOptions, {
                placeHolder: 'Select where to save this file (matches PowerSchool directory structure)',
                matchOnDescription: true
            });
            
            if (!selectedPath) return;
            
            let targetPath = selectedPath.path || selectedPath.label;
            
            // Handle browsing existing folders from PowerSchool
            if (selectedPath.browse) {
                try {
                    vscode.window.showInformationMessage('Loading PowerSchool folder structure...');
                    const rootTree = await api.getFolderTree('/', 2); // Get 2 levels deep
                    
                    const folderList = [];
                    const collectFolders = (folder, currentPath = '/') => {
                        if (folder.subFolders) {
                            folder.subFolders.forEach(subfolder => {
                                const folderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                                folderList.push({
                                    label: folderPath,
                                    description: `${subfolder.pages?.length || 0} files`,
                                    path: folderPath
                                });
                                // Collect nested folders
                                if (subfolder.subFolders && subfolder.subFolders.length > 0) {
                                    collectFolders(subfolder, folderPath);
                                }
                            });
                        }
                    };
                    
                    if (rootTree.folder) {
                        collectFolders(rootTree.folder);
                    }
                    
                    // Sort alphabetically
                    folderList.sort((a, b) => a.label.localeCompare(b.label));
                    
                    const selectedFolder = await vscode.window.showQuickPick(folderList, {
                        placeHolder: 'Select a PowerSchool folder',
                        matchOnDescription: true
                    });
                    
                    if (!selectedFolder) return;
                    targetPath = selectedFolder.path;
                    
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to load PowerSchool folders: ${error.message}`);
                    return;
                }
            }
            // Handle custom path input
            else if (selectedPath.custom) {
                const customPath = await vscode.window.showInputBox({
                    prompt: 'Enter PowerSchool directory path (file will be saved locally in matching structure)',
                    placeHolder: '/admin/custom',
                    validateInput: (value) => {
                        if (!value) return 'Path is required';
                        if (!value.startsWith('/')) return 'Path must start with /';
                        if (value.endsWith('/')) return 'Path should not end with /';
                        return null;
                    }
                });
                if (!customPath) return;
                targetPath = customPath;
            }
            
            // Create local file path that matches PowerSchool structure
            const remotePath = `${targetPath}/${fileName}`;
            const workspaceRoot = global.powerschoolCpmTreeProvider?.localRootPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            const localFilePath = path.join(workspaceRoot, remotePath.replace(/^\/+/g, ''));
            
            // Check if file already exists
            if (fs.existsSync(localFilePath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File already exists at ${remotePath}. Overwrite?`,
                    'Overwrite',
                    'Cancel'
                );
                if (overwrite !== 'Overwrite') return;
            }
            
            // Create local directory if it doesn't exist
            const localDir = path.dirname(localFilePath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
                console.log(`📁 Created directory structure: ${localDir}`);
            }
            
            // Write template content to local file
            fs.writeFileSync(localFilePath, template.content);
            console.log(`📄 Created file: ${localFilePath}`);
            console.log(`🔗 PowerSchool path: ${remotePath}`);
            
            // Open the file in editor
            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);
            
            // Show path info to user
            const relativeToWorkspace = path.relative(workspaceRoot, localFilePath);
            vscode.window.showInformationMessage(
                `Created ${fileName} at ${relativeToWorkspace}\n` +
                `This matches PowerSchool path: ${remotePath}\n` +
                `Edit and use "Publish to PowerSchool" when ready.`
            );
            
        } catch (error) {
            console.error('Failed to create new file:', error);
            vscode.window.showErrorMessage(`Failed to create file: ${error.message}`);
        }
    });
    
    const publishNewFileCommand = registerCommandSafely('ps-vscode-cpm.publishNewFile', async () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active file to publish.');
                return;
            }
            
            const filePath = activeEditor.document.fileName;
            const workspaceRoot = global.powerschoolCpmTreeProvider?.localRootPath;
            if (!workspaceRoot) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            const relativePath = path.relative(workspaceRoot, filePath);
            
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showWarningMessage('File is not in the current workspace.');
                return;
            }
            
            // Convert local path to PowerSchool path format
            const remotePath = '/' + relativePath.replace(/\\/g, '/');
            
            // Try to find similar files to suggest the correct path
            let suggestedPath = remotePath;
            let pathSuggestions = [remotePath];
            
            try {
                console.log('🔍 Looking for similar files to suggest correct path...');
                const fileName = path.basename(filePath);
                const fileNameWithoutExt = path.parse(fileName).name;
                
                // Search in common admin areas first
                const searchPaths = ['/admin/students', '/admin/teachers', '/admin/schools', '/admin', '/public'];
                
                for (const searchPath of searchPaths) {
                    try {
                        const tree = await api.getFolderTree(searchPath, 1);
                        if (tree.folder && tree.folder.pages) {
                            for (const page of tree.folder.pages) {
                                if (page.text.toLowerCase().includes(fileNameWithoutExt.toLowerCase()) || 
                                    fileNameWithoutExt.toLowerCase().includes(page.text.toLowerCase().split('.')[0])) {
                                    const suggestion = `${searchPath}/${page.text}`;
                                    if (!pathSuggestions.includes(suggestion)) {
                                        pathSuggestions.push(suggestion);
                                        console.log(`   💡 Found similar file: ${suggestion}`);
                                    }
                                }
                            }
                        }
                    } catch {
                        // Continue searching other paths
                    }
                }
                
                if (pathSuggestions.length > 1) {
                    suggestedPath = pathSuggestions[1]; // Use the first match found
                }
                
            } catch (error) {
                console.log('   ⚠️ Could not search for similar files:', error.message);
            }

            // Ask user to confirm the PowerSchool path with suggestions
            let confirmedPath;
            if (pathSuggestions.length > 1) {
                const pathChoice = await vscode.window.showQuickPick(
                    pathSuggestions.map(p => ({ label: p, description: p === remotePath ? 'Original guess' : 'Similar file found' })),
                    {
                        placeHolder: 'Select the correct PowerSchool path for this file',
                        canPickMany: false
                    }
                );
                
                if (!pathChoice) return;
                
                confirmedPath = await vscode.window.showInputBox({
                    prompt: 'Confirm or edit the PowerSchool path for this file',
                    value: pathChoice.label,
                    validateInput: (value) => {
                        if (!value) return 'Path is required';
                        if (!value.startsWith('/')) return 'Path must start with /';
                        return null;
                    }
                });
            } else {
                confirmedPath = await vscode.window.showInputBox({
                    prompt: 'Confirm or edit the PowerSchool path for this file (use "Show Full Directory Structure" command to see all paths)',
                    value: suggestedPath,
                    validateInput: (value) => {
                        if (!value) return 'Path is required';
                        if (!value.startsWith('/')) return 'Path must start with /';
                        return null;
                    }
                });
            }
            
            if (!confirmedPath) return;
            
            console.log(`📤 Publishing file to PowerSchool: ${confirmedPath}`);
            vscode.window.showInformationMessage(`Publishing ${path.basename(filePath)} to PowerSchool...`);
            
            // Save the file first if it has unsaved changes
            if (activeEditor.document.isDirty) {
                await activeEditor.document.save();
            }
            
            const fileContent = fs.readFileSync(filePath, 'utf8');
            console.log(`📄 File content (${fileContent.length} chars): ${fileContent.substring(0, 200)}...`);
            
            // Check if file exists on PowerSchool to determine which API endpoint to use
            console.log('🔍 Checking if file exists on PowerSchool...');
            const fileExists = await api.checkFileExists(confirmedPath);
            
            let uploadResult;
            if (fileExists) {
                console.log('✏️  File exists, updating content...');
                uploadResult = await api.updateExistingFileContent(confirmedPath, fileContent);
            } else {
                console.log('🆕 File does not exist, creating new file...');
                uploadResult = await api.createNewFile(confirmedPath, fileContent);
            }
            console.log(`📤 Upload result:`, uploadResult);
            
            // Verify the upload
            vscode.window.showInformationMessage(`Verifying upload of ${path.basename(filePath)}...`);
            const verifiedContent = await api.verifyUpload(confirmedPath);
            
            // Compare content
            const uploadSuccessful = fileContent === verifiedContent;
            
            if (uploadSuccessful) {
                console.log(`✅ Published and verified: ${confirmedPath}`);
                vscode.window.showInformationMessage(`Published ${path.basename(filePath)} successfully! Content verified.`);
                
                // Refresh tree view to show the new file
                treeProvider.refresh();
            } else {
                console.log(`⚠️  Upload completed but verification shows different content`);
                console.log(`   Original length: ${fileContent.length}`);
                console.log(`   Verified length: ${verifiedContent.length}`);
                console.log(`   First difference at char: ${findFirstDifference(fileContent, verifiedContent)}`);
                vscode.window.showWarningMessage(`Published ${path.basename(filePath)} but content verification failed. Check console for details.`);
            }
            
        } catch (error) {
            console.error('❌ Failed to publish file:', error);
            vscode.window.showErrorMessage(`Failed to publish file: ${error.message}`);
        }
    });

    const openSettingsCommand = registerCommandSafely('ps-vscode-cpm.openSettings', async () => {
        // Open the PowerSchool CPM settings
        vscode.commands.executeCommand('workbench.action.openSettings', 'ps-vscode-cpm');
    });

    const setupWebRootCommand = registerCommandSafely('ps-vscode-cpm.setupWebRoot', async () => {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
            const webRootSubdir = config.get('pluginWebRoot') || 'web_root';
            const webRootPath = path.join(workspaceRoot, webRootSubdir);
            
            // Check if web_root already exists
            if (fs.existsSync(webRootPath)) {
                const info = `📂 Plugin web_root directory already exists at:\n${webRootSubdir}/\n\n` +
                    `Files downloaded from PowerSchool will be saved here to match your plugin structure.`;
                vscode.window.showInformationMessage(info);
                return;
            }
            
            // Ask user if they want to create it
            const choice = await vscode.window.showInformationMessage(
                `The plugin web_root directory doesn't exist yet.\n\n` +
                `Create '${webRootSubdir}/' directory?\n\n` +
                `This directory will hold PowerSchool files matching your plugin structure.`,
                'Create Directory',
                'Cancel'
            );
            
            if (choice === 'Create Directory') {
                fs.mkdirSync(webRootPath, { recursive: true });
                console.log(`📁 Created web_root directory: ${webRootPath}`);
                
                // Update tree provider to use new web_root
                const newPluginFilesRoot = getPluginFilesRoot(workspaceRoot);
                treeProvider.localRootPath = newPluginFilesRoot;
                treeProvider.refresh();
                
                vscode.window.showInformationMessage(
                    `✅ Created ${webRootSubdir}/ directory.\n\n` +
                    `PowerSchool files will now be saved here to match your plugin structure.`
                );
            }
            
        } catch (error) {
            console.error('Failed to setup web_root:', error);
            vscode.window.showErrorMessage(`Failed to setup web_root: ${error.message}`);
        }
    });

    const packagePluginCommand = registerCommandSafely('ps-vscode-cpm.packagePlugin', async () => {
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a plugin folder first.');
                return;
            }
            
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const pluginXmlPath = getPluginXmlPath(workspaceRoot);
            // Check if plugin.xml exists
            if (!fs.existsSync(pluginXmlPath)) {
                vscode.window.showErrorMessage('plugin.xml not found in plugin root. This command is for packaging PowerSchool plugins.');
                return;
            }
            // Parse current version from plugin.xml
            const currentVersion = parsePluginVersion(pluginXmlPath);
            console.log(`📦 Current plugin version: ${currentVersion}`);
            
            // Ask if user wants to change version
            const changeVersion = await vscode.window.showQuickPick(['No - Use current version', 'Yes - Update version'], {
                placeHolder: `Current version is ${currentVersion}. Update version?`
            });
            
            if (!changeVersion) return; // User cancelled
            
            let versionToUse = currentVersion;
            
            if (changeVersion.startsWith('Yes')) {
                // Ask for version bump type
                const versionType = await vscode.window.showQuickPick([
                    { label: 'Patch', description: `${currentVersion} → ${incrementVersion(currentVersion, 'patch')}`, value: 'patch' },
                    { label: 'Minor', description: `${currentVersion} → ${incrementVersion(currentVersion, 'minor')}`, value: 'minor' },
                    { label: 'Major', description: `${currentVersion} → ${incrementVersion(currentVersion, 'major')}`, value: 'major' },
                    { label: 'Custom', description: 'Enter a custom version number', value: 'custom' }
                ], {
                    placeHolder: 'Select version increment type (Semantic Versioning)'
                });
                
                if (!versionType) return; // User cancelled
                
                if (versionType.value === 'custom') {
                    const customVersion = await vscode.window.showInputBox({
                        prompt: 'Enter custom version number',
                        value: currentVersion,
                        validateInput: (value) => {
                            if (!value) return 'Version is required';
                            if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/.test(value)) {
                                return 'Version must follow semantic versioning (e.g., 1.0.0 or 1.0.0-beta)';
                            }
                            return null;
                        }
                    });
                    
                    if (!customVersion) return; // User cancelled
                    versionToUse = customVersion;
                } else {
                    versionToUse = incrementVersion(currentVersion, versionType.value);
                }
                
                // Update version in plugin.xml
                if (!updatePluginVersion(pluginXmlPath, versionToUse)) {
                    vscode.window.showErrorMessage('Failed to update version in plugin.xml');
                    return;
                }
                
                console.log(`📝 Updated plugin version to: ${versionToUse}`);
                vscode.window.showInformationMessage(`Updated plugin.xml version to ${versionToUse}`);
            }
            
            // Get plugin name from plugin.xml
            let pluginName = 'plugin';
            try {
                const xmlContent = fs.readFileSync(pluginXmlPath, 'utf8');
                const nameMatch = xmlContent.match(/name="([^"]+)"/);
                if (nameMatch) {
                    // Clean up name for filename (remove spaces, special chars)
                    pluginName = nameMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
                }
            } catch (error) {
                console.warn('Could not parse plugin name from plugin.xml');
            }
            
            // Ask user if they want to edit the plugin filename for the ZIP file
            const editedPluginName = await vscode.window.showInputBox({
                prompt: 'Plugin filename for ZIP (lowercase letters, numbers, hyphens, underscores only)',
                value: pluginName,
                placeHolder: 'my_plugin-name',
                validateInput: (value) => {
                    if (!value) return 'Plugin filename is required';
                    if (!/^[a-z0-9-_]+$/.test(value)) {
                        return 'Plugin filename can only contain lowercase letters, numbers, hyphens, and underscores';
                    }
                    return null;
                }
            });
            
            if (!editedPluginName) return; // User cancelled
            pluginName = editedPluginName;
            
            // Get directories to include
            // Check for common PowerSchool plugin directories (case-sensitive and case-insensitive)
            const potentialDirs = [
                'web_root', 'WEB_ROOT',
                'queries_root', 'QUERIES_ROOT',
                'permissions_root', 'PERMISSIONS_ROOT',
                'MessageKeys', 'messagekeys',
                'pagecataloging', 'PageCataloging'
            ];
            // Directories to include are relative to the plugin root
            const pluginRoot = getPluginFilesRoot(workspaceRoot);
            const dirsToInclude = potentialDirs.filter(dir => {
                const dirPath = path.join(pluginRoot, dir);
                return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
            });
            
            // Remove duplicates if both case variations exist (prefer standard casing)
            const uniqueDirs = [];
            const seen = new Set();
            for (const dir of dirsToInclude) {
                const normalized = dir.toLowerCase();
                if (!seen.has(normalized)) {
                    seen.add(normalized);
                    uniqueDirs.push(dir);
                }
            }
            
            if (uniqueDirs.length === 0) {
                const continueAnyway = await vscode.window.showWarningMessage(
                    'No standard plugin directories found (web_root, queries_root, permissions_root, MessageKeys, pagecataloging).\n\n' +
                    'Continue with just plugin.xml?',
                    'Continue',
                    'Cancel'
                );
                
                if (continueAnyway !== 'Continue') return;
            }
            
            // Show what will be packaged
            const itemsList = ['plugin.xml', ...uniqueDirs].join('\n  • ');
            const confirmPackage = await vscode.window.showInformationMessage(
                `📦 Package plugin v${versionToUse}?\n\nWill include:\n  • ${itemsList}`,
                'Package',
                'Cancel'
            );
            
            if (confirmPackage !== 'Package') return;
            
            // Create the ZIP file
            vscode.window.showInformationMessage('Creating plugin package...');
            const zipFilePath = await createPluginZip(pluginRoot, pluginName, versionToUse, uniqueDirs);
            
            const zipFileName = path.basename(zipFilePath);
            const openFolder = await vscode.window.showInformationMessage(
                `✅ Plugin packaged successfully!\n\n${zipFileName}\n\nReady to install in PowerSchool.`,
                'Show in Folder',
                'OK'
            );
            
            if (openFolder === 'Show in Folder') {
                // Reveal the ZIP file in the file explorer
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipFilePath));
            }
            
            console.log(`✅ Plugin packaged: ${zipFilePath}`);
            
        } catch (error) {
            console.error('Failed to package plugin:', error);
            vscode.window.showErrorMessage(`Failed to package plugin: ${error.message}`);
        }
    });

    const insertSnippetCommand = registerCommandSafely('ps-vscode-cpm.insertSnippet', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active text editor found. Please open a file first.');
                return;
            }

            // Get snippets organized by category
            const snippetsByCategory = getSnippetsByCategory();
            
            // Create organized snippet options with category separators
            const snippetOptions = [];
            
            Object.keys(snippetsByCategory).forEach(category => {
                // Add category header
                snippetOptions.push({
                    label: `── ${category} Snippets ──`,
                    description: '',
                    kind: vscode.QuickPickItemKind.Separator
                });
                
                // Add snippets in this category
                snippetsByCategory[category].forEach(snippetInfo => {
                    // Get the full snippet data using the key
                    const { getSnippet } = require('./code_snippets');
                    const fullSnippet = getSnippet(snippetInfo.key);
                    
                    if (fullSnippet && fullSnippet.content) {
                        const preview = fullSnippet.content.substring(0, 100) + (fullSnippet.content.length > 100 ? '...' : '');
                        
                        snippetOptions.push({
                            label: snippetInfo.name,
                            description: snippetInfo.description,
                            detail: preview,
                            snippetKey: snippetInfo.key,
                            snippetContent: fullSnippet.content
                        });
                    }
                });
            });

            // Show snippet picker
            const selectedSnippet = await vscode.window.showQuickPick(snippetOptions, {
                placeHolder: 'Select a PowerSchool code snippet to insert',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedSnippet || selectedSnippet.kind === vscode.QuickPickItemKind.Separator) {
                return; // User cancelled or selected a separator
            }

            // Insert the snippet at cursor position
            const position = editor.selection.active;
            await editor.edit(editBuilder => {
                editBuilder.insert(position, selectedSnippet.snippetContent);
            });

            vscode.window.showInformationMessage(`Inserted "${selectedSnippet.label}" snippet at cursor position.`);

        } catch (error) {
            console.error('Failed to insert snippet:', error);
            vscode.window.showErrorMessage(`Failed to insert snippet: ${error.message}`);
        }
    });

    // Register individual snippet commands
    const { getSnippet } = require('./code_snippets');
    const snippetKeys = ['box_round', 'calendar', 'dialog', 'dynamic_tabs', 'jquery_function', 'form', 'table', 'tlist_sql', 'collapsible_box', 'if_block', 'student_info', 'breadcrumb'];
    
    const snippetCommands = [];
    snippetKeys.forEach(key => {
        const command = registerCommandSafely(`ps-vscode-cpm.insertSnippet.${key}`, async () => {
            try {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showErrorMessage('No active text editor found. Please open a file first.');
                    return;
                }

                const snippet = getSnippet(key);
                if (!snippet || !snippet.content) {
                    vscode.window.showErrorMessage(`Snippet '${key}' not found or has no content.`);
                    return;
                }

                // Insert the snippet at cursor position
                const position = editor.selection.active;
                await editor.edit(editBuilder => {
                    editBuilder.insert(position, snippet.content);
                });

                vscode.window.showInformationMessage(`Inserted "${snippet.name}" snippet at cursor position.`);

            } catch (error) {
                console.error(`Failed to insert snippet ${key}:`, error);
                vscode.window.showErrorMessage(`Failed to insert snippet: ${error.message}`);
            }
        });
        snippetCommands.push(command);
    });

    // Register individual template commands
    const templateKeys = ['admin', 'adminStudentPage', 'teacher', 'teacherBackpack', 'parentPortal'];
    
    const templateCommands = [];
    templateKeys.forEach(key => {
        const command = registerCommandSafely(`ps-vscode-cpm.createTemplate.${key}`, async () => {
            try {
                const template = getTemplate(key);
                if (!template) {
                    vscode.window.showErrorMessage(`Template '${key}' not found.`);
                    return;
                }

                // Get file name from user
                const fileName = await vscode.window.showInputBox({
                    prompt: `Enter name for new ${template.name}`,
                    placeHolder: `my-new-${key}${template.extension}`,
                    validateInput: (value) => {
                        if (!value) return 'File name is required';
                        if (!value.endsWith(template.extension)) {
                            return `File name must end with ${template.extension}`;
                        }
                        return null;
                    }
                });
                
                if (!fileName) return;

                // Get target directory
                const pathOptions = [
                    { label: '/admin', description: 'Admin pages (admin folder)' },
                    { label: '/admin/students', description: 'Student admin pages' },
                    { label: '/admin/teachers', description: 'Teacher admin pages' },
                    { label: '/admin/schools', description: 'School admin pages' },
                    { label: '/public', description: 'Public pages' },
                    { label: '/images/css', description: 'CSS stylesheets' },
                    { label: '/images/javascript', description: 'JavaScript files' },
                    { label: 'Custom path...', description: 'Enter a custom PowerSchool path' }
                ];
                
                const selectedPath = await vscode.window.showQuickPick(pathOptions, {
                    placeHolder: 'Select where to create the file in PowerSchool'
                });
                
                if (!selectedPath) return;
                
                let targetPath = selectedPath.label;
                if (selectedPath.label === 'Custom path...') {
                    const customPath = await vscode.window.showInputBox({
                        prompt: 'Enter PowerSchool path (e.g., /admin/custom)',
                        placeHolder: '/admin/custom',
                        validateInput: (value) => {
                            if (!value) return 'Path is required';
                            if (!value.startsWith('/')) return 'Path must start with /';
                            return null;
                        }
                    });
                    if (!customPath) return;
                    targetPath = customPath;
                }
                
                // Create local file path
                const remotePath = `${targetPath}/${fileName}`;
                const workspaceRoot = global.powerschoolCpmTreeProvider?.localRootPath;
                if (!workspaceRoot) {
                    vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                    return;
                }
                const localFilePath = path.join(workspaceRoot, remotePath.replace(/^\/+/g, ''));
                
                // Create local directory if it doesn't exist
                const localDir = path.dirname(localFilePath);
                if (!fs.existsSync(localDir)) {
                    fs.mkdirSync(localDir, { recursive: true });
                }
                
                // Write template content to local file
                fs.writeFileSync(localFilePath, template.content);
                
                // Open the file in editor
                const document = await vscode.workspace.openTextDocument(localFilePath);
                await vscode.window.showTextDocument(document);
                
                vscode.window.showInformationMessage(`Created ${fileName} from ${template.name} template. Edit and use "Publish to PowerSchool" when ready.`);

            } catch (error) {
                console.error(`Failed to create template ${key}:`, error);
                vscode.window.showErrorMessage(`Failed to create template: ${error.message}`);
            }
        });
        templateCommands.push(command);
    });

    context.subscriptions.push(treeView, workspaceWatcher, configWatcher, refreshCommand, testConnectionCommand, downloadCommand, publishCommand, publishCurrentCommand, showCurrentFilePathCommand, createNewFileCommand, publishNewFileCommand, openSettingsCommand, setupWebRootCommand, packagePluginCommand, insertSnippetCommand, ...snippetCommands, ...templateCommands);
    
    vscode.window.showInformationMessage('PowerSchool CPM: Extension activated! Use the PowerSchool CPM icon in the Activity Bar to access your files.');
}

function deactivate() {
    // Clean up any resources if needed
    
    // Dispose tree view
    if (global.powerschoolCpmTreeView) {
        try {
            global.powerschoolCpmTreeView.dispose();
        } catch (error) {
            // Silent cleanup
        }
        global.powerschoolCpmTreeView = null;
    }
    
    if (global.powerschoolCpmTreeProvider) {
        global.powerschoolCpmTreeProvider = null;
    }
}

module.exports = {
    activate,
    deactivate
};
