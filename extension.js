const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { getTemplatesByCategory, getTemplate } = require('./templates');
const { getSnippetsByCategory } = require('./code_snippets');

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
    constructor(label, collapsibleState, resourceUri, contextValue, remotePath, psApi, localRootPath) {
        super(label, collapsibleState);
        this.resourceUri = resourceUri;
        this.contextValue = contextValue;
        this.remotePath = remotePath;
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        
        if (contextValue === 'file') {
            this.command = {
                command: 'ps-vscode-cpm.downloadFile',
                title: 'Download File',
                arguments: [this]
            };
            this.iconPath = this.getFileIcon();
        } else {
            this.iconPath = new vscode.ThemeIcon('folder');
        }
        
        this.tooltip = contextValue === 'file' ? 
            `${label}\nClick to download from PowerSchool` :
            `${label} folder`;
    }
    
    getFileIcon() {
        const localPath = path.join(this.localRootPath, this.remotePath.replace(/^\/+/g, ''));
        const exists = fs.existsSync(localPath);
        
        if (exists) {
            return new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.green'));
        } else {
            return new vscode.ThemeIcon('cloud-download', new vscode.ThemeColor('charts.blue'));
        }
    }
}

class PowerSchoolTreeProvider {
    constructor(psApi, localRootPath) {
        this.psApi = psApi;
        this.localRootPath = localRootPath;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.treeCache = new Map();
    }
    
    refresh() {
        this.treeCache.clear();
        this._onDidChangeTreeData.fire();
    }
    
    getTreeItem(element) {
        return element;
    }
    
    async getChildren(element) {
        try {
            // Check if workspace is available
            if (!this.localRootPath) {
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
                    return this.createTreeItems(rootTree.folder, '/');
                }
                return [];
            } else if (element.contextValue === 'folder') {
                const cacheKey = element.remotePath;
                
                if (this.treeCache.has(cacheKey)) {
                    return this.treeCache.get(cacheKey);
                }
                
                console.log(`📂 Loading folder: ${element.remotePath}`);
                const folderTree = await this.psApi.getFolderTree(element.remotePath, 1);
                
                if (folderTree.folder) {
                    const items = this.createTreeItems(folderTree.folder, element.remotePath);
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
    
    createTreeItems(folderData, currentPath) {
        const items = [];
        
        // Sort subfolders alphabetically and add to items
        if (folderData.subFolders) {
            const sortedSubfolders = [...folderData.subFolders].sort((a, b) => 
                a.text.toLowerCase().localeCompare(b.text.toLowerCase())
            );
            
            for (const subfolder of sortedSubfolders) {
                const folderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                const item = new PowerSchoolTreeItem(
                    subfolder.text,
                    vscode.TreeItemCollapsibleState.Collapsed,
                    null,
                    'folder',
                    folderPath,
                    this.psApi,
                    this.localRootPath
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
                const item = new PowerSchoolTreeItem(
                    page.text,
                    vscode.TreeItemCollapsibleState.None,
                    null,
                    'file',
                    filePath,
                    this.psApi,
                    this.localRootPath
                );
                items.push(item);
            }
        }
        
        return items;
    }
    
    async downloadFile(treeItem) {
        try {
            // Create local path that mirrors PowerSchool structure
            const localFilePath = path.join(this.localRootPath, treeItem.remotePath.replace(/^\/+/g, ''));
            
            const localDir = path.dirname(localFilePath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
                console.log(`📁 Created directory: ${path.relative(this.localRootPath, localDir)}`);
            }
            
            console.log(`📥 Downloading: ${treeItem.remotePath}`);
            console.log(`💾 Local path: ${path.relative(this.localRootPath, localFilePath)}`);
            vscode.window.showInformationMessage(`Downloading ${treeItem.label}...`);
            
            const fileContent = await this.downloadFileContent(treeItem.remotePath);
            fs.writeFileSync(localFilePath, fileContent);
            
            console.log(`✅ Downloaded: ${treeItem.remotePath}`);
            const relativeLocalPath = path.relative(this.localRootPath, localFilePath);
            vscode.window.showInformationMessage(
                `Downloaded ${treeItem.label} to ${relativeLocalPath}`
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
        
        await this.psApi.ensureAuthenticated();
        
        const options = {
            hostname: new URL(this.psApi.baseUrl).hostname,
            port: 443,
            path: `/ws/cpm/builtintext?${queryParams.toString()}`,
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

class PowerSchoolAPI {
    constructor() {
        // Use only VS Code settings - no environment variables
        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        this.baseUrl = config.get('serverUrl');
        this.clientId = config.get('clientId');
        this.clientSecret = config.get('clientSecret');
        this.username = config.get('username');
        this.password = config.get('password');
        this.authMethod = config.get('authMethod') || 'oauth';
        
        // OAuth properties
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.tokenType = 'Bearer';
        
        // Session properties
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.sessionCheckInterval = 5 * 60 * 1000;
        this.cookies = new Map();
        
        // Validate required settings based on auth method
        this.validateCredentials();
    }

    validateCredentials() {
        const hasOAuth = this.baseUrl && this.clientId && this.clientSecret;
        const hasSession = this.baseUrl && this.username && this.password;
        
        if (this.authMethod === 'oauth' && !hasOAuth) {
            console.warn('PowerSchool CPM: OAuth credentials not configured. Please configure client ID and secret in VS Code settings.');
        } else if (this.authMethod === 'session' && !hasSession) {
            console.warn('PowerSchool CPM: Session credentials not configured. Please configure username and password in VS Code settings.');
        } else if (this.authMethod === 'hybrid') {
            if (!hasOAuth) {
                console.warn('PowerSchool CPM: OAuth credentials missing for hybrid mode. Please configure client ID and secret.');
            }
            if (!hasSession) {
                console.warn('PowerSchool CPM: Session credentials missing for hybrid mode. Please configure username and password.');
            }
        }
    }

    // Clear authentication state and reload configuration
    clearAuth() {
        console.log('🔒 Clearing PowerSchool authentication state...');
        // Clear OAuth state
        this.accessToken = null;
        this.tokenExpiry = 0;
        // Clear session state
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.cookies.clear();
        
        // Reload configuration from VS Code settings
        this.reloadConfig();
    }

    // Reload configuration from VS Code settings
    reloadConfig() {
        console.log('⚙️ Reloading PowerSchool configuration from VS Code settings...');
        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        this.baseUrl = config.get('serverUrl');
        this.clientId = config.get('clientId');
        this.clientSecret = config.get('clientSecret');
        this.username = config.get('username');
        this.password = config.get('password');
        this.authMethod = config.get('authMethod') || 'oauth';
        
        this.validateCredentials();
        console.log(`📡 PowerSchool configuration loaded: ${this.baseUrl} (method: ${this.authMethod})`);
    }

    // OAuth token request
    async requestAccessToken() {
        console.log('🔐 Requesting OAuth access token...');
        
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        const postData = new URLSearchParams({
            grant_type: 'client_credentials'
        }).toString();

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/oauth/access_token',
            method: 'POST',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'ps-vscode-cpm/2.5.0'
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
                        if (res.statusCode === 200) {
                            const tokenData = JSON.parse(data);
                            this.accessToken = tokenData.access_token;
                            this.tokenType = tokenData.token_type || 'Bearer';
                            // Set expiry time (subtract 60 seconds for safety margin)
                            this.tokenExpiry = Date.now() + ((tokenData.expires_in - 60) * 1000);
                            console.log('✅ OAuth token acquired successfully');
                            resolve(true);
                        } else {
                            console.error('❌ OAuth token request failed:', res.statusCode, data);
                            reject(new Error(`OAuth authentication failed: ${res.statusCode} ${data}`));
                        }
                    } catch (error) {
                        console.error('❌ Error parsing OAuth response:', error);
                        reject(error);
                    }
                });
            });
            req.on('error', (error) => {
                console.error('❌ OAuth request error:', error);
                reject(error);
            });
            req.write(postData);
            req.end();
        });
    }

    // Get authorization header for API requests
    getAuthHeader() {
        if (!this.accessToken) return '';
        return `${this.tokenType} ${this.accessToken}`;
    }

    // Session-based authentication methods
    parseCookies(cookieHeaders) {
        if (!cookieHeaders) return;
        
        for (const cookie of cookieHeaders) {
            const [nameValue] = cookie.split(';');
            const [name, value] = nameValue.split('=');
            if (name && value) {
                this.cookies.set(name.trim(), value.trim());
            }
        }
    }

    getCookieHeader() {
        if (this.cookies.size === 0) return '';
        
        const cookieStrings = [];
        for (const [name, value] of this.cookies) {
            cookieStrings.push(`${name}=${value}`);
        }
        return cookieStrings.join('; ');
    }

    async getLoginPage() {
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/pw.html',
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'ps-vscode-cpm/2.5.0'
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                this.parseCookies(res.headers['set-cookie']);
                resolve();
            });
            req.on('error', reject);
            req.end();
        });
    }

    async submitLogin() {
        const postData = new URLSearchParams({
            username: this.username,
            password: this.password,
            ldappassword: this.password,
            request_locale: 'en_US'
        }).toString();

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/home.html',
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Cookie': this.getCookieHeader(),
                'Referer': `${this.baseUrl}/admin/pw.html`
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                this.parseCookies(res.headers['set-cookie']);
                
                if (res.statusCode === 200 || res.statusCode === 302) {
                    this.sessionValid = true;
                    this.lastSessionCheck = Date.now();
                    resolve(true);
                } else {
                    resolve(false);
                }
            });
            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    async checkSession() {
        if (this.sessionValid && (Date.now() - this.lastSessionCheck < this.sessionCheckInterval)) {
            return true;
        }

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/customization/home.html',
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Cookie': this.getCookieHeader()
            }
        };

        return new Promise((resolve) => {
            const req = https.request(options, (res) => {
                this.lastSessionCheck = Date.now();
                this.parseCookies(res.headers['set-cookie']);
                
                if (res.statusCode === 200) {
                    this.sessionValid = true;
                    resolve(true);
                } else {
                    this.sessionValid = false;
                    resolve(false);
                }
            });
            req.on('error', () => {
                this.sessionValid = false;
                resolve(false);
            });
            req.end();
        });
    }

    async ensureSessionAuthenticated() {
        let isLoggedIn = await this.checkSession();
        
        if (!isLoggedIn) {
            if (!this.username || !this.password) {
                throw new Error('PowerSchool session credentials missing. Please configure username and password in VS Code settings.');
            }
            
            await this.getLoginPage();
            isLoggedIn = await this.submitLogin();
            
            if (!isLoggedIn) {
                throw new Error('PowerSchool login failed. Please check your credentials.');
            }
        }
        
        return true;
    }





    // Check if access token is valid and not expired
    isTokenValid() {
        return this.accessToken && Date.now() < this.tokenExpiry;
    }

    // Determine which authentication method to use for a given endpoint
    getAuthMethodForEndpoint(endpoint) {
        if (this.authMethod === 'session') return 'session';
        if (this.authMethod === 'oauth') return 'oauth';
        
        // Hybrid mode - use session for CPM endpoints, OAuth for others
        if (this.authMethod === 'hybrid') {
            return endpoint.includes('/ws/cpm/') ? 'session' : 'oauth';
        }
        
        return 'oauth'; // default
    }

    // Ensure we have appropriate authentication for the endpoint
    async ensureAuthenticated(endpoint = '') {
        const method = this.getAuthMethodForEndpoint(endpoint);
        
        console.log(`🔐 Authentication decision for endpoint '${endpoint}': using ${method} method`);
        
        if (method === 'session') {
            console.log('🍪 Using session authentication');
            return await this.ensureSessionAuthenticated();
        } else {
            console.log('🔑 Using OAuth authentication');
            return await this.ensureOAuthAuthenticated();
        }
    }

    // Ensure we have a valid OAuth access token
    async ensureOAuthAuthenticated() {
        if (!this.isTokenValid()) {
            if (!this.clientId || !this.clientSecret) {
                throw new Error('PowerSchool OAuth credentials missing. Please configure client ID and secret in VS Code settings.');
            }
            
            try {
                await this.requestAccessToken();
            } catch (error) {
                console.error('❌ OAuth authentication failed:', error.message);
                throw new Error(`OAuth authentication failed: ${error.message}. Please verify your client credentials and ensure the PowerSchool plugin is properly configured with OAuth permissions.`);
            }
        }
        
        return true;
    }

    // Get appropriate authentication headers for the endpoint
    getAuthHeadersForEndpoint(endpoint) {
        const method = this.getAuthMethodForEndpoint(endpoint);
        
        if (method === 'session') {
            return { 'Cookie': this.getCookieHeader() };
        } else {
            return { 'Authorization': this.getAuthHeader() };
        }
    }

    // Test OAuth connectivity with comprehensive endpoint testing
    async testOAuthConnection() {
        console.log('🧪 Starting comprehensive OAuth connection test...');
        
        try {
            await this.ensureAuthenticated();
            
            // Test 1: Basic time API (should always work)
            console.log('📅 Testing basic API access with /ws/v1/time...');
            const timeResult = await this.testEndpoint('/ws/v1/time', 'Basic API');
            
            // Test 2: CPM tree endpoint (with appropriate auth method)
            console.log('🌳 Testing CPM tree endpoint /ws/cpm/tree...');
            const cmpResult = await this.testEndpointWithAuth('/ws/cpm/tree?path=/&maxDepth=1', 'CPM Tree');
            
            // Test 3: Try alternative CPM paths
            console.log('🔍 Testing alternative CPM paths...');
            const altResults = await Promise.allSettled([
                this.testEndpoint('/ws/cpm/builtintext?path=/admin/home.html', 'CPM BuiltinText'),
                this.testEndpoint('/ws/cpm/folders', 'CPM Folders'),
                this.testEndpoint('/admin/customization/home.html', 'CPM Admin Page')
            ]);
            
            // Compile results
            const results = {
                basicAPI: timeResult,
                cpmTree: cmpResult,
                alternatives: altResults.map(r => r.status === 'fulfilled' ? r.value : r.reason)
            };
            
            console.log('📊 OAuth Test Results:', results);
            return results;
            
        } catch (error) {
            console.error('❌ OAuth connection test failed:', error);
            throw error;
        }
    }

    // Test a specific endpoint with appropriate authentication
    async testEndpointWithAuth(path, description) {
        await this.ensureAuthenticated(path);
        const authHeaders = this.getAuthHeadersForEndpoint(path);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: path,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
            }
        };

        return this.executeTestRequest(options, description, path);
    }

    // Test a specific endpoint and return detailed results (OAuth only)
    async testEndpoint(path, description) {
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: path,
            method: 'GET',
            rejectUnauthorized: false,
            headers: {
                'Authorization': this.getAuthHeader(),
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0'
            }
        };

        return this.executeTestRequest(options, description, path);
    }

    // Execute the actual test request
    async executeTestRequest(options, description, path) {

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    const result = {
                        description,
                        path,
                        status: res.statusCode,
                        success: res.statusCode >= 200 && res.statusCode < 300,
                        headers: res.headers,
                        dataPreview: data.substring(0, 200),
                        authMethod: this.getAuthMethodForEndpoint(path)
                    };
                    
                    if (result.success) {
                        console.log(`✅ ${description}: ${res.statusCode} (${result.authMethod})`);
                    } else {
                        console.log(`❌ ${description}: ${res.statusCode} (${result.authMethod}) - ${data.substring(0, 100)}`);
                    }
                    
                    resolve(result);
                });
            });
            req.on('error', (error) => {
                console.log(`🚫 ${description}: Network Error - ${error.message}`);
                resolve({
                    description,
                    path,
                    status: 0,
                    success: false,
                    error: error.message,
                    authMethod: this.getAuthMethodForEndpoint(path)
                });
            });
            req.end();
        });
    }

    async getFolderTree(path = '/', maxDepth = 1) {
        const endpoint = `/ws/cpm/tree`;
        await this.ensureAuthenticated(endpoint);
        
        const queryParams = new URLSearchParams({
            path: path,
            maxDepth: maxDepth.toString()
        });
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `${endpoint}?${queryParams.toString()}`,
            method: 'GET',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
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
                        if (res.statusCode === 200) {
                            const response = JSON.parse(data);
                            resolve(response);
                        } else if (res.statusCode === 401) {
                            // Specific handling for authentication errors
                            const errorMsg = data.includes('Must be logged in') 
                                ? 'CPM API authentication failed. This likely means:\n1. The PowerSchool plugin is not installed/enabled\n2. Permission mappings are missing\n3. Your admin user lacks access to customization pages\n\nPlease install the powerschool-cmp-plugin.zip file in PowerSchool Admin > Plugin Management Dashboard.'
                                : `Authentication failed: ${data}`;
                            reject(new Error(`API Error ${res.statusCode}: ${errorMsg}`));
                        } else if (res.statusCode === 403) {
                            // Specific handling for permission errors
                            const errorMsg = 'Permission denied. This means:\n1. Permission mappings are not properly configured\n2. Your admin user lacks access to required pages\n3. The plugin may not have proper CPM API permissions\n\nEnsure the PowerSchool plugin is installed with permission mappings.';
                            reject(new Error(`API Error ${res.statusCode}: ${errorMsg}`));
                        } else {
                            const response = data.startsWith('{') ? JSON.parse(data) : { message: data };
                            reject(new Error(`API Error ${res.statusCode}: ${response.message || data}`));
                        }
                    } catch (parseError) {
                        reject(new Error(`API Error ${res.statusCode}: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            req.end();
        });
    }

    async createNewFile(filePath, content) {
        const endpoint = '/ws/cpm/createAsset';
        await this.ensureAuthenticated(endpoint);
        
        console.log('🆕 CREATING NEW FILE ON POWERSCHOOL:');
        console.log(`   File path: ${filePath}`);
        console.log(`   Content length: ${content.length} characters`);
        
        const pathParts = filePath.split('/');
        const fileName = pathParts.pop();
        const folderPath = pathParts.join('/') || '/';
        
        const createData = new URLSearchParams({
            'newAssetName': fileName,
            'newAssetPath': folderPath,
            'newAssetType': 'file',
            'newAssetRoot': ''
        }).toString();
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
        const createOptions = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(createData),
                ...authHeaders
            }
        };
        
        return new Promise((resolve, reject) => {
            const req = https.request(createOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log('📤 CREATE FILE API RESPONSE:');
                    console.log(`   Status: ${res.statusCode}`);
                    console.log(`   Raw response: ${data}`);
                    
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200 && response.returnMessage && response.returnMessage.includes('successfully')) {
                            console.log('   ✅ File created successfully, now adding content...');
                            this.updateExistingFileContent(filePath, content).then(resolve).catch(reject);
                        } else {
                            reject(new Error(`Failed to create file: ${response.returnMessage || data}`));
                        }
                    } catch (parseError) {
                        reject(new Error(`PowerSchool returned invalid JSON: ${parseError.message}`));
                    }
                });
            });
            req.on('error', reject);
            req.write(createData);
            req.end();
        });
    }

    async updateExistingFileContent(filePath, content) {
        const endpoint = '/ws/cpm/customPageContent';
        await this.ensureAuthenticated(endpoint);
        
        console.log('✏️  UPDATING EXISTING FILE CONTENT:');
        console.log(`   File path: ${filePath}`);
        console.log(`   Content length: ${content.length} characters`);
        
        // Get file info to get customContentId
        const fileInfo = await this.downloadFileInfo(filePath);
        
        // Generate key path from file path (remove leading slash and replace / with .)
        const keyPath = filePath.replace(/^\/+/, '').replace(/\//g, '.').replace(/\.(html|htm|js|css|txt)$/i, '');
        
        // Generate boundary for multipart data
        const boundary = `----formdata-node-${Math.random().toString(36).substr(2, 16)}`;
        
        // Create multipart form data according to PowerSchool API spec
        const formFields = {
            'customContentId': fileInfo.activeCustomContentId || fileInfo.draftCustomContentId || 0,
            'customContent': content,
            'customContentPath': filePath,
            'keyPath': keyPath,
            'keyValueMap': 'null',
            'publish': 'true'  // Publish directly
        };
        
        const multipartData = this.generateMultipartData(formFields, boundary);
        
        console.log(`   Using boundary: ${boundary}`);
        console.log(`   Custom content ID: ${formFields.customContentId}`);
        console.log(`   Key path: ${keyPath}`);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(multipartData),
                ...authHeaders
            }
        };
        
        console.log(`   Request URL: https://${options.hostname}${options.path}`);

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log('📤 UPDATE FILE API RESPONSE:');
                    console.log(`   Status: ${res.statusCode}`);
                    console.log(`   Raw response: ${data}`);
                    
                    try {
                        const response = JSON.parse(data);
                        console.log(`   Parsed response:`, response);
                        
                        if (res.statusCode === 200) {
                            console.log('   ✅ File content updated successfully');
                            resolve(response);
                        } else {
                            console.log(`   ❌ Update failed with status ${res.statusCode}`);
                            reject(new Error(`Update failed ${res.statusCode}: ${response.returnMessage || data}`));
                        }
                    } catch (parseError) {
                        console.log(`   ❌ Failed to parse update response: ${parseError.message}`);
                        reject(new Error(`PowerSchool returned invalid JSON: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.log(`   ❌ Update request error: ${error.message}`);
                reject(error);
            });
            
            req.write(multipartData);
            req.end();
        });
    }

    async checkFileExists(filePath) {
        try {
            await this.downloadFileInfo(filePath);
            return true;
        } catch (error) {
            console.log(`   ℹ️  File ${filePath} does not exist on PowerSchool: ${error.message}`);
            return false;
        }
    }

    generateMultipartData(fields, boundary) {
        let data = '';
        for (const [name, value] of Object.entries(fields)) {
            data += `--${boundary}\r\n`;
            data += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
            data += `${value}\r\n`;
        }
        data += `--${boundary}--\r\n`;
        return data;
    }

    async downloadFileInfo(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        const endpoint = `/ws/cpm/builtintext`;
        await this.ensureAuthenticated(endpoint);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `${endpoint}?${queryParams.toString()}`,
            method: 'GET',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
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
                            resolve(response);
                        } else {
                            reject(new Error(`Failed to get file info: ${response.message || data}`));
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

    async verifyUpload(filePath) {
        console.log('🔍 VERIFYING UPLOAD:');
        console.log(`   Re-downloading ${filePath} to verify changes...`);
        
        try {
            // Wait a moment for PowerSchool to process the upload
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const verifyContent = await this.downloadFileContent(filePath);
            console.log(`   Verification content length: ${verifyContent.length}`);
            console.log(`   Verification preview: ${verifyContent.substring(0, 200)}${verifyContent.length > 200 ? '...' : ''}`);
            return verifyContent;
        } catch (error) {
            console.log(`   ❌ Verification failed: ${error.message}`);
            throw error;
        }
    }

    async downloadFileContent(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        const endpoint = `/ws/cpm/builtintext`;
        await this.ensureAuthenticated(endpoint);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: `${endpoint}?${queryParams.toString()}`,
            method: 'GET',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
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
                            // Return the active custom text or built-in text
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

    async getCompleteDirectoryStructure(rootPath = '/', maxDepth = 3) {
        console.log('🌲 SCANNING COMPLETE POWERSCHOOL DIRECTORY STRUCTURE');
        console.log('====================================================');
        
        const scannedPaths = new Set();
        const allFiles = [];
        const allFolders = [];

        const scanFolder = async (currentPath, depth = 0) => {
            if (depth > maxDepth || scannedPaths.has(currentPath)) {
                return;
            }
            
            scannedPaths.add(currentPath);
            console.log(`${'  '.repeat(depth)}📂 Scanning: ${currentPath} (depth ${depth})`);
            
            try {
                const tree = await this.getFolderTree(currentPath, 1);
                
                if (tree.folder) {
                    const folderInfo = {
                        path: currentPath,
                        name: tree.folder.text,
                        depth: depth
                    };
                    allFolders.push(folderInfo);
                    
                    // Scan subfolders
                    if (tree.folder.subFolders && tree.folder.subFolders.length > 0) {
                        for (const subfolder of tree.folder.subFolders) {
                            const subfolderPath = currentPath === '/' ? `/${subfolder.text}` : `${currentPath}/${subfolder.text}`;
                            await scanFolder(subfolderPath, depth + 1);
                        }
                    }
                    
                    // Collect files
                    if (tree.folder.pages && tree.folder.pages.length > 0) {
                        for (const page of tree.folder.pages) {
                            const filePath = currentPath === '/' ? `/${page.text}` : `${currentPath}/${page.text}`;
                            const fileInfo = {
                                path: filePath,
                                name: page.text,
                                folderPath: currentPath,
                                depth: depth
                            };
                            allFiles.push(fileInfo);
                            console.log(`${'  '.repeat(depth + 1)}📄 ${filePath}`);
                        }
                    }
                }
                
                // Small delay to avoid overwhelming the server
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.log(`${'  '.repeat(depth)}❌ Error scanning ${currentPath}: ${error.message}`);
            }
        };

        await scanFolder(rootPath, 0);
        
        console.log(`\\n📊 SCAN COMPLETE: Found ${allFiles.length} files in ${allFolders.length} folders`);
        
        return {
            files: allFiles.sort((a, b) => a.path.localeCompare(b.path)),
            folders: allFolders.sort((a, b) => a.path.localeCompare(b.path)),
            totalFiles: allFiles.length,
            totalFolders: allFolders.length
        };
    }

    async testUploadEndpoint() {
        await this.ensureAuthenticated();
        
        console.log('🔍 TESTING UPLOAD ENDPOINT AVAILABILITY:');
        
        // Try different possible upload endpoints
        const possibleEndpoints = [
            '/ws/cpm/updatetext',
            '/ws/cpm/save',
            '/ws/cpm/upload',
            '/admin/customization/save.html',
            '/admin/customization/updatetext.html'
        ];
        
        for (const endpoint of possibleEndpoints) {
            console.log(`   Testing: ${endpoint}`);
            
            const options = {
                hostname: new URL(this.baseUrl).hostname,
                port: 443,
                path: endpoint,
                method: 'OPTIONS', // Use OPTIONS to test endpoint availability
                rejectUnauthorized: false, // Accept self-signed certificates
                headers: {
                    'Referer': `${this.baseUrl}/admin/customization/home.html`,
                    'User-Agent': 'ps-vscode-cpm/2.5.0',
                    'Authorization': this.getAuthHeader()
                }
            };
            
            try {
                const result = await new Promise((resolve) => {
                    const req = https.request(options, (res) => {
                        console.log(`     Status: ${res.statusCode}`);
                        resolve({ endpoint, status: res.statusCode, available: res.statusCode !== 404 });
                    });
                    req.on('error', () => {
                        resolve({ endpoint, status: 'error', available: false });
                    });
                    req.setTimeout(5000, () => {
                        req.abort();
                        resolve({ endpoint, status: 'timeout', available: false });
                    });
                    req.end();
                });
                
                if (result.available) {
                    console.log(`     ✅ ${endpoint} appears to be available`);
                } else {
                    console.log(`     ❌ ${endpoint} not available`);
                }
            } catch (error) {
                console.log(`     ❌ ${endpoint} error: ${error.message}`);
            }
        }
    }

    async uploadFileContent(filePath, content) {
        const endpoint = '/ws/cpm/customPageContent';
        
        console.log('🔍 HYBRID AUTH DEBUG:');
        console.log(`   Auth method setting: ${this.authMethod}`);
        console.log(`   Endpoint: ${endpoint}`);
        console.log(`   Selected auth method: ${this.getAuthMethodForEndpoint(endpoint)}`);
        
        await this.ensureAuthenticated(endpoint);
        
        console.log('🔍 UPLOAD DEBUG INFO (CORRECT PowerSchool API):');
        console.log(`   File path: ${filePath}`);
        console.log(`   Content length: ${content.length} characters`);
        console.log(`   Content preview: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);
        
        // First try to get the file info to get customContentId if it exists
        let fileInfo = null;
        try {
            fileInfo = await this.downloadFileInfo(filePath);
        } catch (error) {
            console.log(`   ℹ️  File doesn't exist on PowerSchool yet (new file): ${error.message}`);
            fileInfo = { activeCustomContentId: 0 }; // New file
        }
        
        // Generate key path from file path (remove leading slash and replace / with .)
        const keyPath = filePath.replace(/^\/+/, '').replace(/\//g, '.').replace(/\.(html|htm|js|css|txt)$/i, '');
        
        // Generate boundary for multipart data
        const boundary = `----formdata-node-${Math.random().toString(36).substr(2, 16)}`;
        
        // Create multipart form data according to PowerSchool API spec
        const formFields = {
            'customContentId': fileInfo.activeCustomContentId || 0,
            'customContent': content,
            'customContentPath': filePath,
            'keyPath': keyPath,
            'keyValueMap': 'null',
            'publish': 'true'  // Publish directly instead of saving as draft
        };
        
        const multipartData = generateMultipartData(formFields, boundary);
        
        console.log(`   Using boundary: ${boundary}`);
        console.log(`   Custom content ID: ${formFields.customContentId}`);
        console.log(`   Key path: ${keyPath}`);
        console.log(`   Multipart data length: ${multipartData.length} bytes`);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false, // Accept self-signed certificates
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(multipartData),
                ...authHeaders
            }
        };
        
        console.log(`   Request URL: https://${options.hostname}${options.path}`);
        console.log(`   OAuth token: ${this.accessToken ? 'Present' : 'Missing'}`);

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    console.log('📤 PowerSchool CPM API RESPONSE:');
                    console.log(`   Status: ${res.statusCode}`);
                    console.log(`   Headers:`, res.headers);
                    console.log(`   Raw response: ${data}`);
                    
                    try {
                        const response = JSON.parse(data);
                        console.log(`   Parsed response:`, response);
                        
                        if (res.statusCode === 200) {
                            console.log('   ✅ PowerSchool upload completed successfully');
                            if (response.returnMessage && response.returnMessage.includes('successfully')) {
                                console.log(`   ✅ Success message: ${response.returnMessage}`);
                                resolve(response);
                            } else {
                                console.log(`   ⚠️  Unexpected response: ${response.returnMessage}`);
                                resolve(response);
                            }
                        } else {
                            console.log(`   ❌ Upload failed with status ${res.statusCode}`);
                            reject(new Error(`Upload failed ${res.statusCode}: ${response.returnMessage || data}`));
                        }
                    } catch (parseError) {
                        console.log(`   ❌ Failed to parse response JSON: ${parseError.message}`);
                        console.log(`   Raw data: ${data.substring(0, 500)}${data.length > 500 ? '...' : ''}`);
                        reject(new Error(`PowerSchool returned invalid JSON response: ${parseError.message}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                console.log(`   ❌ Request error: ${error.message}`);
                reject(error);
            });
            
            req.write(multipartData);
            req.end();
        });
    }
}

// Helper function to get the actual root path for PowerSchool files
// Checks for web_root subdirectory or uses workspace root
function getPluginFilesRoot(workspaceRoot) {
    if (!workspaceRoot) return null;
    
    const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
    const webRootSubdir = config.get('pluginWebRoot') || 'web_root';
    
    // If setting is empty, use workspace root directly
    if (!webRootSubdir || webRootSubdir.trim() === '') {
        console.log(`📁 Using workspace root for plugin files: ${workspaceRoot}`);
        return workspaceRoot;
    }
    
    // Check if web_root subdirectory exists
    const webRootPath = path.join(workspaceRoot, webRootSubdir);
    if (fs.existsSync(webRootPath) && fs.statSync(webRootPath).isDirectory()) {
        console.log(`📁 Found plugin web_root directory: ${webRootPath}`);
        return webRootPath;
    }
    
    // web_root doesn't exist - ask user if they want to create it
    console.log(`⚠️  Plugin web_root directory not found: ${webRootPath}`);
    console.log(`📁 Using workspace root instead: ${workspaceRoot}`);
    return workspaceRoot;
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
    console.log('🚀 PowerSchool CPM extension activation started!');

    // Prevent double activation
    if (global.powerschoolCpmActivated) {
        console.warn('PowerSchool CPM already activated, skipping...');
        return;
    }
    global.powerschoolCpmActivated = true;
    
    console.log('✅ PowerSchool CPM activation flag set');

    // Get workspace folder - use the first workspace folder as root
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let workspaceRootPath = null;
    let pluginFilesRoot = null;
    
    if (workspaceFolders && workspaceFolders.length > 0) {
        workspaceRootPath = workspaceFolders[0].uri.fsPath;
        pluginFilesRoot = getPluginFilesRoot(workspaceRootPath);
        console.log(`📁 Workspace root: ${workspaceRootPath}`);
        console.log(`📂 Plugin files root: ${pluginFilesRoot}`);
    } else {
        console.log('No workspace folder found - extension will prompt user to open folder when needed.');
    }

    // Initialize PowerSchool API and Tree Provider
    console.log('🔧 Initializing PowerSchool API and Tree Provider...');
    const api = new PowerSchoolAPI();
    const treeProvider = new PowerSchoolTreeProvider(api, pluginFilesRoot);
    
    // Store globally for cleanup
    global.powerschoolCpmTreeProvider = treeProvider;
    console.log('📂 Tree provider created');

    // Watch for workspace changes to update the tree provider
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let newWorkspaceRootPath = null;
        let newPluginFilesRoot = null;
        
        if (workspaceFolders && workspaceFolders.length > 0) {
            newWorkspaceRootPath = workspaceFolders[0].uri.fsPath;
            newPluginFilesRoot = getPluginFilesRoot(newWorkspaceRootPath);
            console.log(`📁 Workspace changed`);
            console.log(`   Workspace root: ${newWorkspaceRootPath}`);
            console.log(`   Plugin files root: ${newPluginFilesRoot}`);
        } else {
            console.log('📁 Workspace closed, no root directory available');
        }
        
        treeProvider.localRootPath = newPluginFilesRoot;
        treeProvider.refresh();
    });

    // Watch for configuration changes to update API settings
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ps-vscode-cpm')) {
            console.log('⚙️ PowerSchool CPM settings changed, refreshing connection...');
            
            // Clear authentication and reload configuration
            api.clearAuth();
            
            // Check if web_root path changed
            if (e.affectsConfiguration('ps-vscode-cpm.pluginWebRoot')) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    const newPluginFilesRoot = getPluginFilesRoot(workspaceFolders[0].uri.fsPath);
                    console.log(`📂 Plugin files root updated: ${newPluginFilesRoot}`);
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
        console.log('🌲 Tree view created successfully');
        
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
        console.log('🔄 Refresh command executed - clearing authentication and refreshing tree');
        
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
            
            console.log('📋 Full test results:', results);
            
            if (results.basicAPI.success) {
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showErrorMessage('❌ OAuth authentication failed. Check your credentials and server URL.');
            }
            
        } catch (error) {
            console.error('❌ Connection test failed:', error);
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
                    console.error('Failed to browse folders:', error);
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
            const pluginXmlPath = path.join(workspaceRoot, 'plugin.xml');
            
            // Check if plugin.xml exists
            if (!fs.existsSync(pluginXmlPath)) {
                vscode.window.showErrorMessage('plugin.xml not found in workspace root. This command is for packaging PowerSchool plugins.');
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
            const dirsToInclude = potentialDirs.filter(dir => {
                const dirPath = path.join(workspaceRoot, dir);
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
            const zipFilePath = await createPluginZip(workspaceRoot, pluginName, versionToUse, uniqueDirs);
            
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
    
    console.log('� PowerSchool CPM extension fully activated!');
    console.log('📋 Registered commands:', Object.keys(vscode.commands.getCommands ? {} : {'refresh': 'ps-vscode-cpm.refresh'}));
    vscode.window.showInformationMessage('PowerSchool CPM: Extension activated! Use the PowerSchool CPM icon in the Activity Bar to access your files.');
}

function deactivate() {
    // Clean up any resources if needed
    console.log('PowerSchool CPM extension deactivated');
    
    // Clear activation flag and cached data
    global.powerschoolCpmActivated = false;
    
    // Dispose tree view
    if (global.powerschoolCpmTreeView) {
        try {
            global.powerschoolCpmTreeView.dispose();
        } catch (error) {
            console.warn('Error disposing tree view during deactivation:', error.message);
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
