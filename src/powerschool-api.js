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
        this.accessToken = '';
        this.tokenExpiry = null;
        this.authMethod = 'hybrid'; // 'oauth', 'session', or 'hybrid'
        this.sessionCookies = '';
        this.lastSessionCheck = null;
    }

    // Initialize from VS Code settings
    initialize() {
        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        this.baseUrl = config.get('serverUrl', '').replace(/\/$/, '');
        this.authMethod = config.get('authMethod', 'hybrid');
        
        if (!this.baseUrl) {
            throw new Error('PowerSchool server URL not configured. Please set ps-vscode-cpm.serverUrl in settings.');
        }
    }

    clearAuth() {
        this.accessToken = '';
        this.tokenExpiry = null;
        this.sessionCookies = '';
        this.lastSessionCheck = null;
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

    getAuthHeadersForEndpoint(endpoint) {
        const authMethod = this.getAuthMethodForEndpoint(endpoint);
        
        if (authMethod === 'session') {
            return { 'Cookie': this.sessionCookies };
        } else {
            return { 'Authorization': `Bearer ${this.accessToken}` };
        }
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

        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        const clientId = config.get('clientId');
        const clientSecret = config.get('clientSecret');

        if (!clientId || !clientSecret) {
            throw new Error('OAuth credentials not configured. Please set ps-vscode-cpm.clientId and ps-vscode-cpm.clientSecret in settings.');
        }

        const tokenEndpoint = '/oauth/access_token';
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
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

    async ensureSessionAuth() {
        const now = Date.now();
        if (this.sessionCookies && this.lastSessionCheck && (now - this.lastSessionCheck) < 5 * 60 * 1000) {
            return; // Session checked within last 5 minutes
        }

        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        const username = config.get('username');
        const password = config.get('password');

        if (!username || !password) {
            throw new Error('Session credentials not configured. Please set ps-vscode-cpm.username and ps-vscode-cpm.password in settings.');
        }

        const loginData = new URLSearchParams({
            'account': username,
            'pw': password,
            'translatedMDY': new Date().toLocaleDateString('en-US')
        }).toString();

        const options = {
            hostname: new URL(this.baseUrl).hostname,
            port: 443,
            path: '/admin/home.html',
            method: 'POST',
            rejectUnauthorized: false,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(loginData),
                'User-Agent': 'ps-vscode-cpm/2.5.0'
            }
        };

        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                const cookies = res.headers['set-cookie'];
                if (res.statusCode === 302 && cookies) {
                    this.sessionCookies = cookies.map(cookie => cookie.split(';')[0]).join('; ');
                    this.lastSessionCheck = now;
                    resolve();
                } else {
                    reject(new Error('Session authentication failed'));
                }
            });

            req.on('error', error => reject(new Error(`Session login failed: ${error.message}`)));
            req.write(loginData);
            req.end();
        });
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