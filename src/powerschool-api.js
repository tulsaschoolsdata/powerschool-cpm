const vscode = require('vscode');
const https = require('https');

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
        this.clientId = '';
        this.clientSecret = '';
        this.username = '';
        this.password = '';
        this.authMethod = 'hybrid'; // 'oauth', 'session', or 'hybrid'
        
        // OAuth properties
        this.accessToken = null;
        this.tokenExpiry = 0;
        this.tokenType = 'Bearer';
        
        // Session properties
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.sessionCheckInterval = 5 * 60 * 1000; // 5 minutes
        this.cookies = new Map();
        this.sessionCookies = '';
    }

    // Initialize from VS Code settings
    initialize() {
        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        this.baseUrl = config.get('serverUrl', '').replace(/\/$/, '');
        this.clientId = config.get('clientId');
        this.clientSecret = config.get('clientSecret');
        this.username = config.get('username');
        this.password = config.get('password');
        this.authMethod = config.get('authMethod', 'hybrid');
        
        if (!this.baseUrl) {
            throw new Error('PowerSchool server URL not configured. Please set ps-vscode-cpm.serverUrl in settings.');
        }
    }

    clearAuth() {
        // Clear OAuth state
        this.accessToken = null;
        this.tokenExpiry = 0;
        // Clear session state
        this.sessionValid = false;
        this.lastSessionCheck = 0;
        this.cookies.clear();
        this.sessionCookies = '';
    }

    getAuthMethodForEndpoint(endpoint) {
        if (this.authMethod === 'session') return 'session';
        if (this.authMethod === 'oauth') return 'oauth';
        
        // HYBRID: CPM and PowerQuery endpoints need session, others use OAuth
        if (this.authMethod === 'hybrid') {
            if (endpoint.includes('/ws/cpm/') || endpoint.includes('/ws/schema/query/')) {
                return 'session';
            }
            return 'oauth';
        }
        
        return 'oauth'; // fallback
    }

    async ensureAuthenticated(endpoint = '/ws/v1/school') {
        const authMethod = this.getAuthMethodForEndpoint(endpoint);
        
        if (authMethod === 'session') {
            await this.ensureSessionAuth();
        } else {
            await this.ensureOAuthToken();
        }
    }

    async ensureOAuthToken() {
        if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
            return; // Token is still valid
        }

        if (!this.clientId || !this.clientSecret) {
            throw new Error('OAuth credentials not configured. Please set ps-vscode-cpm.clientId and ps-vscode-cpm.clientSecret in settings.');
        }

        const tokenEndpoint = '/oauth/access_token';
        const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
        
        const postData = 'grant_type=client_credentials';
        
        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: tokenEndpoint,
            method: 'POST',
            rejectUnauthorized: false,
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
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        if (res.statusCode === 200 && response.access_token) {
                            this.accessToken = response.access_token;
                            this.tokenExpiry = Date.now() + (response.expires_in * 1000);
                            resolve();
                        } else {
                            reject(new Error(`OAuth failed: ${response.error || 'Unknown error'}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse OAuth response: ${error.message}`));
                    }
                });
            });

            req.on('error', error => reject(new Error(`OAuth request failed: ${error.message}`)));
            req.write(postData);
            req.end();
        });
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

    async ensureSessionAuth() {
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

    getAuthHeadersForEndpoint(endpoint) {
        const method = this.getAuthMethodForEndpoint(endpoint);
        
        if (method === 'session') {
            return { 'Cookie': this.getCookieHeader() };
        } else {
            return { 'Authorization': `${this.tokenType} ${this.accessToken}` };
        }
    }

    async makeRequest(endpoint, method = 'GET', data = null) {
        await this.ensureAuthenticated(endpoint);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
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

    async testOAuthConnection() {
        const results = {
            basicAPI: { success: false, error: null },
            cpmTree: { success: false, error: null, status: null },
            alternatives: []
        };

        try {
            await this.ensureOAuthToken();
            const response = await this.makeRequest('/ws/v1/school');
            results.basicAPI.success = response.statusCode === 200;
            if (!results.basicAPI.success) {
                results.basicAPI.error = `HTTP ${response.statusCode}`;
            }
        } catch (error) {
            results.basicAPI.error = error.message;
        }

        try {
            const response = await this.makeRequest('/ws/cpm/tree?path=/&maxDepth=1');
            results.cpmTree.success = response.statusCode === 200;
            results.cpmTree.status = response.statusCode;
            if (!results.cpmTree.success) {
                results.cpmTree.error = `HTTP ${response.statusCode}`;
            }
        } catch (error) {
            results.cpmTree.error = error.message;
        }

        return results;
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

    async getPluginFileMappings() {
        const endpoint = '/ws/schema/query/com.powerschool.cpm.file.mappings';
        const response = await this.makeRequest(endpoint, 'POST', {});
        
        if (response.statusCode !== 200) {
            throw new Error(`Failed to get plugin mappings: HTTP ${response.statusCode}`);
        }

        return response.data?.record || [];
    }

    async downloadFileContent(filePath) {
        const queryParams = new URLSearchParams({
            LoadFolderInfo: 'false',
            path: filePath
        });
        
        const endpoint = `/ws/cpm/builtintext?${queryParams.toString()}`;
        await this.ensureAuthenticated(endpoint);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
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
                            resolve(result.customPageContent || '');
                        } catch (error) {
                            resolve(data);
                        }
                    } else {
                        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', error => reject(error));
            req.end();
        });
    }

    async uploadFileContent(filePath, content) {
        const endpoint = '/ws/cpm/customPageContent';
        await this.ensureAuthenticated(endpoint);
        
        // Try to get existing file info
        let fileInfo = null;
        try {
            fileInfo = await this.downloadFileInfo(filePath);
        } catch (error) {
            // File doesn't exist, that's ok
        }
        
        // Generate key path from file path
        const keyPath = filePath.replace(/^\/+/, '').replace(/\//g, '.').replace(/\.(html|htm|js|css|txt)$/i, '');
        
        // Generate boundary for multipart data
        const boundary = `----formdata-node-${Math.random().toString(36).substr(2, 16)}`;
        
        // Create multipart form data
        const formFields = {
            'customContentId': fileInfo?.activeCustomContentId || 0,
            'customContent': content,
            'customContentPath': filePath,
            'keyPath': keyPath,
            'keyValueMap': 'null',
            'publish': 'true'
        };
        
        const multipartData = generateMultipartData(formFields, boundary);
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
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
                            resolve(result);
                        } catch (error) {
                            resolve({ success: true, raw: data });
                        }
                    } else {
                        reject(new Error(`Upload failed: HTTP ${res.statusCode}`));
                    }
                });
            });
            
            req.on('error', error => reject(error));
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
        await this.ensureAuthenticated(endpoint);
        
        const authHeaders = this.getAuthHeadersForEndpoint(endpoint);
        
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
                            resolve(JSON.parse(data));
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
}

module.exports = { PowerSchoolAPI };