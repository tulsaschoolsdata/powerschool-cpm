const vscode = require('vscode');
const https = require('https');
const pathUtils = require('./path-utils');

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

class PowerSchoolAPI {
    constructor() {
        this.baseUrl = '';
        this.username = '';
        this.password = '';

        // Session properties
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.sessionCheckInterval = 5 * 60 * 1000; // 5 minutes
        this.cookies = new Map();
        this.sessionCookies = '';
        
        // Cache for customContentId (in-memory + persistent storage)
        // Map: filePath -> customContentId
        this.contentIdCache = new Map();
        this.workspaceState = null; // Set by extension on init
    }
    
    // Set workspace state storage (called by extension.js)
    setWorkspaceState(state) {
        this.workspaceState = state;
        this.loadCacheFromStorage();
    }
    
    // Load cache from persistent storage
    loadCacheFromStorage() {
        if (!this.workspaceState) return;
        
        const stored = this.workspaceState.get('ps-cpm-contentIdCache', {});
        this.contentIdCache = new Map(Object.entries(stored));
    }
    
    // Save cache to persistent storage
    saveCacheToStorage() {
        if (!this.workspaceState) return;
        
        const obj = Object.fromEntries(this.contentIdCache);
        this.workspaceState.update('ps-cpm-contentIdCache', obj);
    }

    // Initialize from VS Code settings
    initialize() {
        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        this.baseUrl = config.get('serverUrl', '').replace(/\/$/, '');
        this.username = config.get('username');
        this.password = config.get('password');
        // --- Session Cookie Bypass: Load the cookie from settings ---
        this.sessionCookie = config.get('sessionCookie', '').trim();
        this.useSessionCookie = !!this.sessionCookie;

        if (!this.baseUrl) {
            throw new Error('PowerSchool server URL not configured. Please set ps-vscode-cpm.serverUrl in settings.');
        }
        // Warn if user sets both cookie and user/pass
        if (this.useSessionCookie && this.username && this.password) {
            vscode.window.showWarningMessage('ps-vscode-cpm: Session cookie will take precedence over username/password.');
        }
    }

    clearAuth() {
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.cookies.clear();
        this.sessionCookies = '';
        this.sessionCookie = '';
        this.useSessionCookie = false;
        // DON'T clear content ID cache - it persists across auth changes
        // this.contentIdCache.clear();
    }

    async ensureAuthenticated() {
        await this.ensureSessionAuth();
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

    /**
     * Return the cookie header for outgoing requests.
     * If session cookie bypass is enabled, always use the configured cookie.
     */
    getCookieHeader() {
        if (this.useSessionCookie && this.sessionCookie) {
            return this.sessionCookie;
        }
        if (this.cookies.size === 0) {
            return '';
        }
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

    /**
     * Ensure the session is authenticated.
     * If session cookie bypass is enabled, trust the cookie—skip login/session check logic.
     */
    async ensureSessionAuth() {
        if (this.useSessionCookie && this.sessionCookie) {
            // Skip all login/session checks if bypass is enabled
            this.sessionValid = true;
            return true;
        }
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

    /**
     * Get authentication headers for PowerSchool API requests.
     * Prefer session cookie if present, else use built cookie from login sequence.
     */
    getAuthHeaders() {
        return { 'Cookie': this.getCookieHeader() };
    }

    async makeRequest(endpoint, method = 'GET', data = null) {
        await this.ensureAuthenticated();

        const authHeaders = this.getAuthHeaders();
        const isPost = method === 'POST';
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: method,
            rejectUnauthorized: false,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
            }
        };

        if (isPost && data) {
            const postData = typeof data === 'string' ? data : JSON.stringify(data);
            options.headers['Content-Type'] = typeof data === 'string' ? 'application/x-www-form-urlencoded' : 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', chunk => responseData += chunk);
                res.on('end', () => {
                    if (res.statusCode === 403) {
                        reject(new Error('Insufficient PowerSchool permissions. Ensure your account has CPM admin access.'));
                        return;
                    }
                    try {
                        const result = responseData ? JSON.parse(responseData) : {};
                        resolve({ statusCode: res.statusCode, data: result });
                    } catch (error) {
                        resolve({ statusCode: res.statusCode, data: responseData });
                    }
                });
            });

            req.on('error', error => reject(error));
            
            if (isPost && data) {
                const postData = typeof data === 'string' ? data : JSON.stringify(data);
                req.write(postData);
            }
            
            req.end();
        });
    }

    async getFolderTree(path = '/', maxDepth = 1) {
        const queryParams = new URLSearchParams({
            path: path,
            maxDepth: maxDepth.toString()
        });

        const endpoint = `/ws/cpm/tree?${queryParams.toString()}`;
        const response = await this.makeRequest(endpoint);
        
        if (response.statusCode !== 200) {
            throw new Error(`Failed to get folder tree: HTTP ${response.statusCode}`);
        }

        return response.data;
    }

    /**
     * Downloads and parses plugin mappings from a server-generated JSON file.
     * The JSON file contains tlist_sql template that generates plugin metadata.
     * Uses direct HTTP access (not /ws/cpm/builtintext) to get the executed JSON.
     * Expected format: [{ "path": "/path/to/file.html", "plugin": "PluginName", "enabled": "1" }]
     */
    async getPluginMappingsFromJson(jsonFilePath = '/vscode_cpm/plugin_data.json') {
        try {
            const endpoint = jsonFilePath;
            const response = await this.makeRequest(endpoint);
            
            if (response.statusCode !== 200) {
                return null;
            }

            // Parse the JSON content
            let pluginData;
            try {
                if (typeof response.data === 'string') {
                    pluginData = JSON.parse(response.data);
                } else {
                    pluginData = response.data;
                }
            } catch (parseError) {
                return null;
            }

            // Normalize to object format if it's an array
            if (Array.isArray(pluginData)) {
                const normalized = {};
                pluginData.forEach(item => {
                    if (item.path) {
                        normalized[item.path] = {
                            plugin: item.plugin || item.pluginName || 'Unknown',
                            enabled: item.enabled !== false
                        };
                    }
                });
                pluginData = normalized;
            }
            
            return pluginData;
        } catch (error) {
            return null;
        }
    }

    /**
     * Returns the file listing for a schema root.
     * GET /ws/cpm/content?root=...
     * Mirrors cpmServices.js getContentRoot() (lines 690-703).
     * @param {string} root - 'queries_root' or 'user_schema_root'
     */
    async getSchemaRootTree(root) {
        const queryParams = new URLSearchParams({ root });
        const endpoint = `/ws/cpm/content?${queryParams.toString()}`;
        const response = await this.makeRequest(endpoint);
        if (response.statusCode !== 200) {
            throw new Error(`Failed to get schema root tree: HTTP ${response.statusCode}`);
        }
        return response.data;
    }

    /**
     * Fetches content for a file in a schema root.
     * GET /ws/cpm/customresource?path=...&root=...
     * Mirrors cpmServices.js getNonWebContent() (lines 734-762).
     * @param {string} filePath - File path within the schema root
     * @param {string} root - 'queries_root' or 'user_schema_root'
     * @returns {Promise<{content: string, isCustom: boolean, activeCustomContentId: number|null}>}
     */
    async getSchemaFileContent(filePath, root) {
        const queryParams = new URLSearchParams({ path: filePath, root });
        const endpoint = `/ws/cpm/customresource?${queryParams.toString()}`;
        const response = await this.makeRequest(endpoint);
        if (response.statusCode !== 200) {
            throw new Error(`Failed to get schema file: HTTP ${response.statusCode}`);
        }
        const result = /** @type {any} */ (response.data);
        const content = result.activeCustomText || result.builtInText || '';
        const customContentId = result.activeCustomContentId || null;
        if (customContentId) {
            this.contentIdCache.set(filePath, customContentId);
            this.saveCacheToStorage();
        }
        return { content, isCustom: result.isCustom === true, activeCustomContentId: customContentId };
    }

    async downloadFileContent(filePath) {
        const result = await this.downloadFileWithMetadata(filePath);
        return result.content;
    }

    /**
     * Downloads file content along with metadata (customContentId, etc.)
     * Used for conflict detection during sync operations.
     * @param {string} filePath - Remote path to the file
     * @returns {Promise<{content: string, customContentId: number|null, isCustom: boolean, rawResponse: object}>}
     */
    async downloadFileWithMetadata(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });

        const endpoint = `/ws/cpm/builtintext?${queryParams.toString()}`;
        await this.ensureAuthenticated();

        const authHeaders = this.getAuthHeaders();

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'GET',
            rejectUnauthorized: false,
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
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const result = JSON.parse(data);
                            // Priority order for content:
                            // 1. customPageContent - custom files (when using LoadFolderInfo=false)
                            // 2. builtInText - built-in files (actual content, or "Built in file... not available" if doesn't exist)
                            // 3. activeCustomText - customized files (or "Active custom file... not available" for non-custom)
                            // Check builtInText first and only use it if it's not an error message
                            let content = '';
                            if (result.builtInText && !result.builtInText.startsWith('Built in file')) {
                                content = result.builtInText;
                            } else if (result.customPageContent) {
                                content = result.customPageContent;
                            } else if (result.activeCustomText && !result.activeCustomText.startsWith('Active custom file')) {
                                content = result.activeCustomText;
                            }

                            // Extract customContentId and cache it
                            // Fallback: if no active content yet but version history exists, use first entry
                            let customContentId = result.activeCustomContentId || null;
                            if (!customContentId && result.versionAssetContentIds && result.versionAssetContentIds.length > 0) {
                                customContentId = result.versionAssetContentIds[0];
                            }
                            if (customContentId) {
                                this.contentIdCache.set(filePath, customContentId);
                                this.saveCacheToStorage();
                            }

                            resolve({
                                content,
                                customContentId,
                                isCustom: result.isCustom === true,
                                rawResponse: result
                            });
                        } catch (error) {
                            resolve({
                                content: data,
                                customContentId: null,
                                isCustom: false,
                                rawResponse: null
                            });
                        }
                    } else if (res.statusCode === 403) {
                        reject(new Error('Insufficient PowerSchool permissions to access this file.'));
                    } else {
                        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                    }
                });
            });

            req.on('error', error => reject(error));
            req.end();
        });
    }

    async uploadFileContent(filePath, content, { isCustom = true, builtInContent = '' } = {}) {
        await this.ensureAuthenticated();

        // If the file has never been customized, promote it first to create an initial draft
        if (!isCustom) {
            await this.customizeAsset(filePath, builtInContent);
            // contentIdCache now has the new activeCustomContentId set by customizeAsset
        }

        // FIRST: Check cache for existing customContentId (fastest path)
        const cachedId = this.contentIdCache.get(filePath);
        if (cachedId) {
            try {
                const result = await this._doUpload(filePath, content, cachedId);
                return result;
            } catch (error) {
                // Cache is stale - clear it and continue to fetch fresh ID
                this.contentIdCache.delete(filePath);
                // Fall through to fetch actual ID
            }
        }
        
        // SECOND: No cache, try to fetch actual customContentId from PowerSchool
        // This handles existing files that weren't cached yet
        try {
            const fileInfo = await this.downloadFileInfo(filePath);
            const customContentId = fileInfo?.activeCustomContentId;
            
            if (customContentId) {
                this.contentIdCache.set(filePath, customContentId);
                this.saveCacheToStorage();
                return await this._doUpload(filePath, content, customContentId);
            }
        } catch (error) {
            // File doesn't exist on PowerSchool - it's a new file
        }
        
        // THIRD: File is new, use customContentId: 0
        try {
            const result = await this._doUpload(filePath, content, 0);
            return result;
        } catch (error) {
            throw error;
        }
    }
    
    async _doUpload(filePath, content, customContentId) {
        const endpoint = '/ws/cpm/customPageContent';
        
        // Generate key path from file path
        const keyPath = filePath.replace(/^\/+/, '').replace(/\//g, '.').replace(/\.(html|htm|js|css|txt)$/i, '');
        
        // Generate boundary for multipart data
        const boundary = `----formdata-node-${Math.random().toString(36).substr(2, 16)}`;
        
        // Create multipart form data
        const formFields = {
            'customContentId': customContentId,  // Use provided ID (0 for new, actual ID for updates)
            'customContent': content,
            'customContentPath': filePath,
            'keyPath': keyPath,
            'keyValueMap': 'null',
            'publish': 'true'
        };
        
        const multipartData = generateMultipartData(formFields, boundary);
        const authHeaders = this.getAuthHeaders();
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(multipartData),
                ...authHeaders
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const result = JSON.parse(data);
                            
                            // PowerSchool returns HTTP 200 even on errors - check the message
                            if (result.returnMessage && result.returnMessage.includes('system error')) {
                                reject(new Error(result.returnMessage));
                            } else if (result.returnMessage && result.returnMessage.includes('could not be saved')) {
                                reject(new Error(result.returnMessage));
                            } else {
                                // Update cache with new activeCustomContentId returned after publish
                                if (result.activeCustomContentId) {
                                    this.contentIdCache.set(filePath, result.activeCustomContentId);
                                    this.saveCacheToStorage();
                                }
                                resolve(result);
                            }
                        } catch (error) {
                            resolve({ success: true, raw: data });
                        }
                    } else if (res.statusCode === 403) {
                        reject(new Error('Insufficient PowerSchool permissions to publish this file.'));
                    } else {
                        reject(new Error(`Upload failed: HTTP ${res.statusCode}`));
                    }
                });
            });

            req.on('error', error => {
                reject(error);
            });
            req.write(multipartData);
            req.end();
        });
    }

    async downloadFileInfo(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'true',
            path: filePath
        });

        const endpoint = `/ws/cpm/builtintext?${queryParams.toString()}`;
        await this.ensureAuthenticated();
        
        const authHeaders = this.getAuthHeaders();
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'GET',
            rejectUnauthorized: false,
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
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const fileInfo = JSON.parse(data);
                            // Cache the customContentId for future uploads
                            if (fileInfo.activeCustomContentId) {
                                this.contentIdCache.set(filePath, fileInfo.activeCustomContentId);
                                this.saveCacheToStorage();
                            }
                            resolve(fileInfo);
                        } catch (error) {
                            reject(new Error('Failed to parse file info response'));
                        }
                    } else {
                        reject(new Error(`File info request failed: HTTP ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', error => reject(error));
            req.end();
        });
    }

    /**
     * Promotes a built-in asset to a customizable one by creating an initial draft.
     * Must be called before the first customPageContent save when isCustom = false.
     * Mirrors cpmServices.js customizeAsset() (lines 802-828).
     * @param {string} filePath - Remote path (e.g., /admin/home.html)
     * @param {string} builtInContent - The builtInText from the prior builtintext response
     * @returns {Promise<{activeCustomContentId: number}>}
     */
    async customizeAsset(filePath, builtInContent) {
        const endpoint = '/ws/cpm/customizeAsset';
        await this.ensureAuthenticated();

        const fileName = filePath.split('/').pop() || '';
        const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));

        const postData = new URLSearchParams({
            initialAssetContent: builtInContent || '',
            newAssetName: fileName,
            newAssetPath: folderPath,
            newAssetType: 'file'
        }).toString();

        const authHeaders = this.getAuthHeaders();
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        try {
                            const result = JSON.parse(data);
                            if (result.activeCustomContentId) {
                                this.contentIdCache.set(filePath, result.activeCustomContentId);
                                this.saveCacheToStorage();
                            }
                            resolve(result);
                        } catch (e) {
                            reject(new Error('Failed to parse customizeAsset response'));
                        }
                    } else if (res.statusCode === 403) {
                        reject(new Error('Insufficient PowerSchool permissions to customize this file.'));
                    } else {
                        reject(new Error(`customizeAsset failed: HTTP ${res.statusCode}`));
                    }
                });
            });
            req.on('error', error => reject(error));
            req.write(postData);
            req.end();
        });
    }

    async verifyUpload(filePath) {
        try {
            return await this.downloadFileContent(filePath);
        } catch (error) {
            throw new Error(`Verification failed: ${error.message}`);
        }
    }

    async checkFileExists(filePath) {
        try {
            await this.downloadFileInfo(filePath);
            return true;
        } catch (error) {
            return false;
        }
    }

    async createNewFile(filePath, content) {
        return await this.uploadFileContent(filePath, content);
    }

    async updateExistingFileContent(filePath, content) {
        return await this.uploadFileContent(filePath, content);
    }

    /**
     * Delete a custom file from PowerSchool.
     * If the file is a built-in file that was customized, this removes the customization.
     * @param {string} filePath - Remote path to the file (e.g., /admin/custom.html)
     * @returns {Promise<{success: boolean, message: string}>}
     */
    async deleteFile(filePath) {
        const endpoint = '/ws/cpm/deleteFile';
        await this.ensureAuthenticated();

        const postData = `path=${encodeURIComponent(filePath)}`;
        const authHeaders = this.getAuthHeaders();

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: endpoint,
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Referer': `${this.baseUrl}/admin/customization/home.html`,
                'Accept': 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'User-Agent': 'ps-vscode-cpm/2.5.0',
                ...authHeaders
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(data);

                        if (res.statusCode === 200) {
                            // Check for success message
                            if (result.returnMessage === 'The file was deleted sucessfully') {
                                // Note: PowerSchool has a typo in "sucessfully" - matching their API
                                // Remove from cache since file no longer exists
                                this.contentIdCache.delete(filePath);
                                this.saveCacheToStorage();

                                resolve({ success: true, message: 'File deleted successfully' });
                            } else if (result.returnMessage) {
                                reject(new Error(result.returnMessage));
                            } else {
                                resolve({ success: true, message: 'File deleted' });
                            }
                        } else if (res.statusCode === 400) {
                            reject(new Error(result.message || 'File could not be deleted'));
                        } else {
                            reject(new Error(`Delete failed: HTTP ${res.statusCode}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse delete response: ${error.message}`));
                    }
                });
            });

            req.on('error', error => reject(new Error(`Delete request failed: ${error.message}`)));
            req.write(postData);
            req.end();
        });
    }
}

module.exports = { PowerSchoolAPI };