const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { getTemplatesByCategory, getTemplate } = require('./templates');
const { getSnippetsByCategory, getSnippet } = require('./code_snippets');

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

// Use centralized path logic from path-utils
const pathUtils = require('./path-utils');

// Remove all local getPluginFilesRoot logic. Use pathUtils.getPluginFilesRoot() everywhere.

// Helper to get the path to plugin.xml in the plugin root
function getPluginXmlPath() {
    const pluginRoot = pathUtils.getPluginFilesRoot();
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
        // Silent fallback
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
async function createPluginZip(pluginName, version, dirsToInclude) {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const pluginFilesRoot = pathUtils.getPluginFilesRoot();
    const zipFileName = `${pluginName}-${version}.zip`;
    const zipFilePath = path.join(pluginFilesRoot, zipFileName);
    // Remove old zip if exists
    if (fs.existsSync(zipFilePath)) {
        fs.unlinkSync(zipFilePath);
    }
    // Build list of items to include
    const itemsToZip = ['plugin.xml', ...dirsToInclude].filter(item => {
        const itemPath = path.join(pluginFilesRoot, item);
        return fs.existsSync(itemPath);
    });
    if (itemsToZip.length === 0) {
        throw new Error('No items found to package. Ensure plugin.xml and directories exist.');
    }
    // Create zip using native zip command
    const zipCommand = `cd "${pluginFilesRoot}" && zip -r "${zipFileName}" ${itemsToZip.map(i => `"${i}"`).join(' ')}`;
    try {
        await execAsync(zipCommand);
        return zipFilePath;
    } catch (error) {
        throw new Error(`Failed to create ZIP file: ${error.message}`);
    }
}

function registerCommands(context, api, treeProvider) {
    // Safe command registration helper
    const registerCommandSafely = (commandId, callback) => {
        try {
            return vscode.commands.registerCommand(commandId, callback);
        } catch (error) {
            return { dispose: () => {} }; // Mock disposable
        }
    };
    
    const commands = [];
    
    // Refresh command
    commands.push(registerCommandSafely('ps-vscode-cpm.refresh', () => {
        api.clearAuth();
        treeProvider.refresh();
        vscode.window.showInformationMessage('PowerSchool connection refreshed! Tree will reload with new settings.');
    }));

    // Test connection command
    commands.push(registerCommandSafely('ps-vscode-cpm.testConnection', async () => {
        try {
            vscode.window.showInformationMessage('🧪 Testing PowerSchool OAuth connection and CPM API access...');
            const results = await api.testOAuthConnection();
            
            let message = '📊 Connection Test Results:\\n\\n';
            message += `✅ Basic API: ${results.basicAPI.success ? 'Working' : 'Failed'}\\n`;
            message += `${results.cpmTree.success ? '✅' : '❌'} CPM Tree: ${results.cpmTree.success ? 'Working' : `Failed (${results.cpmTree.status})`}\\n`;
            
            if (results.basicAPI.success && !results.cpmTree.success) {
                message += '\\n🔍 OAuth is working but CPM APIs are not accessible.\\nThis suggests CPM endpoints may not support OAuth authentication.';
            } else if (results.basicAPI.success && results.cpmTree.success) {
                message += '\\n🎉 Both basic API and CPM APIs are working!';
            }
            
            if (results.basicAPI.success) {
                vscode.window.showInformationMessage(message);
            } else {
                vscode.window.showErrorMessage('❌ OAuth authentication failed. Check your credentials and server URL.');
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`❌ Connection test failed: ${error.message}`);
        }
    }));

    // Test JSON endpoint command
    commands.push(registerCommandSafely('ps-vscode-cpm.testJsonEndpoint', async () => {
        try {
            const jsonFiles = [
                '/admin/reports/registration/js/elem_reg.json',
                '/admin/reports/registration/js/dist_reg.json',
                '/admin/reports/registration/js/num_teachers.json',
                '/admin/reports/registration/js/school_cat_reg.json'
            ];
            
            vscode.window.showInformationMessage(`Testing ${jsonFiles.length} JSON files...`);
            
            let results = `📊 JSON Files Test Results:\n\n`;
            
            for (const jsonPath of jsonFiles) {
                try {
                    const response = await api.makeRequest(jsonPath);
                    const fileName = jsonPath.split('/').pop();
                    
                    if (response.statusCode === 200) {
                        const dataLength = typeof response.data === 'string' ? response.data.length : JSON.stringify(response.data).length;
                        results += `✅ ${fileName}: ${response.statusCode} (${dataLength} bytes)\n`;
                    } else {
                        results += `❌ ${fileName}: ${response.statusCode}\n`;
                    }
                } catch (error) {
                    const fileName = jsonPath.split('/').pop();
                    results += `❌ ${fileName}: ${error.message}\n`;
                }
            }
            
            results += `\n💡 These files exist on the server but are not returned by the /ws/cpm/tree API.\n`;
            results += `They may need to be accessed directly or are filtered by PowerSchool.`;
            
            vscode.window.showInformationMessage(results);
            
        } catch (error) {
            vscode.window.showErrorMessage(`❌ JSON endpoint test failed: ${error.message}`);
        }
    }));
    
    // Download file command
    commands.push(registerCommandSafely('ps-vscode-cpm.downloadFile', async (treeItem) => {
        await treeProvider.downloadFile(treeItem);
    }));
    
    // Publish file command
    commands.push(registerCommandSafely('ps-vscode-cpm.publishFile', async (treeItem) => {
        await treeProvider.publishFile(treeItem);
    }));
    
    // Publish current file command
    commands.push(registerCommandSafely('ps-vscode-cpm.publishCurrentFile', async () => {
        await treeProvider.publishCurrentFile();
    }));
    
    // Show current file path command
    commands.push(registerCommandSafely('ps-vscode-cpm.showCurrentFilePath', async () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showInformationMessage('No file is currently open.');
                return;
            }
            const filePath = activeEditor.document.fileName;
            const pluginFilesRoot = global.powerschoolCpmTreeProvider?.localRootPath || require('./path-utils').getPluginFilesRoot();
            if (!pluginFilesRoot) {
                vscode.window.showInformationMessage('No plugin files root is set.');
                return;
            }
            const relativePath = path.relative(pluginFilesRoot, filePath);
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showInformationMessage(
                    `📄 Current file: ${path.basename(filePath)}\n` +
                    `⚠️  This file is outside the plugin files root.\n` +
                    `Files must be inside the plugin files root to sync with PowerSchool.`
                );
                return;
            }
            const powerSchoolPath = '/' + relativePath.replace(/\\/g, '/');
            let message = `📄 Local file: ${relativePath}\n` +
                `🔗 PowerSchool path: ${powerSchoolPath}\n\n`;
            message += `This file syncs with PowerSchool at the path shown above.\n`;
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
            vscode.window.showErrorMessage(`Failed to show file path: ${error.message}`);
        }
    }));

    // Open settings command
    commands.push(registerCommandSafely('ps-vscode-cpm.openSettings', async () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'ps-vscode-cpm');
    }));

    // Setup web root command
    commands.push(registerCommandSafely('ps-vscode-cpm.setupWebRoot', async () => {
        try {
            const pluginFilesRoot = pathUtils.getPluginFilesRoot();
            if (!pluginFilesRoot) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
            const webRootSubdir = config.get('pluginWebRoot') || 'web_root';
            const webRootPath = path.join(pluginFilesRoot, webRootSubdir);
            if (fs.existsSync(webRootPath)) {
                const info = `📂 Plugin web_root directory already exists at:\n${webRootSubdir}/\n\n` +
                    `Files downloaded from PowerSchool will be saved here to match your plugin structure.`;
                vscode.window.showInformationMessage(info);
                return;
            }
            const choice = await vscode.window.showInformationMessage(
                `The plugin web_root directory doesn't exist yet.\n\n` +
                `Create '${webRootSubdir}/' directory?\n\n` +
                `This directory will hold PowerSchool files matching your plugin structure.`,
                'Create Directory',
                'Cancel'
            );
            if (choice === 'Create Directory') {
                fs.mkdirSync(webRootPath, { recursive: true });
                treeProvider.localRootPath = webRootPath;
                treeProvider.refresh();
                vscode.window.showInformationMessage(
                    `✅ Created ${webRootSubdir}/ directory.\n\n` +
                    `PowerSchool files will now be saved here to match your plugin structure.`
                );
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to setup web_root: ${error.message}`);
        }
    }));

    return commands;
}

function registerFileCommands(context, api, treeProvider) {
    const registerCommandSafely = (commandId, callback) => {
        try {
            return vscode.commands.registerCommand(commandId, callback);
        } catch (error) {
            return { dispose: () => {} };
        }
    };
    
    const commands = [];
    
    // Create new file command
    commands.push(registerCommandSafely('ps-vscode-cpm.createNewFile', async () => {
        try {
            const templatesByCategory = getTemplatesByCategory();
            const templateOptions = [];
            
            Object.keys(templatesByCategory).forEach(category => {
                templateOptions.push({
                    label: `── ${category} Templates ──`,
                    description: '',
                    kind: vscode.QuickPickItemKind.Separator
                });
                
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
            
            // Handle browsing and custom path logic here...
            // (Similar to original implementation but simplified for brevity)
            
            const remotePath = `${targetPath}/${fileName}`;
            const pluginFilesRoot = global.powerschoolCpmTreeProvider?.localRootPath || pathUtils.getPluginFilesRoot();
            if (!pluginFilesRoot) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            const localFilePath = path.join(pluginFilesRoot, remotePath.replace(/^\/+/g, ''));
            
            if (fs.existsSync(localFilePath)) {
                const overwrite = await vscode.window.showWarningMessage(
                    `File already exists at ${remotePath}. Overwrite?`,
                    'Overwrite',
                    'Cancel'
                );
                if (overwrite !== 'Overwrite') return;
            }
            
            const localDir = path.dirname(localFilePath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            
            fs.writeFileSync(localFilePath, template.content);
            
            const document = await vscode.workspace.openTextDocument(localFilePath);
            await vscode.window.showTextDocument(document);
            
            const relativeToRoot = path.relative(pluginFilesRoot, localFilePath);
            vscode.window.showInformationMessage(
                `Created ${fileName} at ${relativeToRoot}\n` +
                `This matches PowerSchool path: ${remotePath}\n` +
                `Edit and use "Publish to PowerSchool" when ready.`
            );
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create file: ${error.message}`);
        }
    }));

    // Publish new file command
    commands.push(registerCommandSafely('ps-vscode-cpm.publishNewFile', async () => {
        try {
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                vscode.window.showWarningMessage('No active file to publish.');
                return;
            }
            
            const pluginFilesRoot = global.powerschoolCpmTreeProvider?.localRootPath || pathUtils.getPluginFilesRoot();
            if (!pluginFilesRoot) {
                vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                return;
            }
            const filePath = activeEditor.document.fileName;
            // Compute relative path from pluginFilesRoot
            const relativePath = path.relative(pluginFilesRoot, filePath).replace(/\\/g, '/');
            if (!relativePath || relativePath.startsWith('..')) {
                vscode.window.showWarningMessage('File is not in the plugin web_root.');
                return;
            }
            const remotePath = '/' + relativePath.replace(/\/+/g, '/');
            const confirmedPath = await vscode.window.showInputBox({
                prompt: 'Confirm or edit the PowerSchool path for this file',
                value: remotePath,
                validateInput: (value) => {
                    if (!value) return 'Path is required';
                    if (!value.startsWith('/')) return 'Path must start with /';
                    return null;
                }
            });
            if (!confirmedPath) return;
            vscode.window.showInformationMessage(`Publishing ${path.basename(filePath)} to PowerSchool...`);
            
            if (activeEditor.document.isDirty) {
                await activeEditor.document.save();
            }
            
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const fileExists = await api.checkFileExists(confirmedPath);
            
            let uploadResult;
            if (fileExists) {
                uploadResult = await api.updateExistingFileContent(confirmedPath, fileContent);
            } else {
                uploadResult = await api.createNewFile(confirmedPath, fileContent);
            }
            
            const verifiedContent = await api.verifyUpload(confirmedPath);
            
            if (fileContent === verifiedContent) {
                vscode.window.showInformationMessage(`Published ${path.basename(filePath)} successfully! Content verified.`);
                treeProvider.refresh();
            } else {
                vscode.window.showWarningMessage(`Published ${path.basename(filePath)} but content verification failed. Check console for details.`);
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to publish file: ${error.message}`);
        }
    }));

    return commands;
}

function registerPluginCommands(context, api, treeProvider) {
    const registerCommandSafely = (commandId, callback) => {
        try {
            return vscode.commands.registerCommand(commandId, callback);
        } catch (error) {
            return { dispose: () => {} };
        }
    };
    
    const commands = [];

    // Package plugin command
    commands.push(registerCommandSafely('ps-vscode-cpm.packagePlugin', async () => {
        try {
            const pluginXmlPath = getPluginXmlPath();
            if (!fs.existsSync(pluginXmlPath)) {
                vscode.window.showErrorMessage('plugin.xml not found in plugin root. This command is for packaging PowerSchool plugins.');
                return;
            }
            const currentVersion = parsePluginVersion(pluginXmlPath);
            
            const changeVersion = await vscode.window.showQuickPick(['No - Use current version', 'Yes - Update version'], {
                placeHolder: `Current version is ${currentVersion}. Update version?`
            });
            
            if (!changeVersion) return;
            
            let versionToUse = currentVersion;
            
            if (changeVersion.startsWith('Yes')) {
                const versionType = await vscode.window.showQuickPick([
                    { label: 'Patch', description: `${currentVersion} → ${incrementVersion(currentVersion, 'patch')}`, value: 'patch' },
                    { label: 'Minor', description: `${currentVersion} → ${incrementVersion(currentVersion, 'minor')}`, value: 'minor' },
                    { label: 'Major', description: `${currentVersion} → ${incrementVersion(currentVersion, 'major')}`, value: 'major' },
                    { label: 'Custom', description: 'Enter a custom version number', value: 'custom' }
                ], {
                    placeHolder: 'Select version increment type (Semantic Versioning)'
                });
                
                if (!versionType) return;
                
                if (versionType.value === 'custom') {
                    const customVersion = await vscode.window.showInputBox({
                        prompt: 'Enter custom version number',
                        value: currentVersion,
                        validateInput: (value) => {
                            if (!value) return 'Version is required';
                            if (!/^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.-]+)?$/.test(value)) {
                                return 'Version must follow semantic versioning (e.g., 1.0.0 or 1.0.0-beta)';
                            }
                            return null;
                        }
                    });
                    
                    if (!customVersion) return;
                    versionToUse = customVersion;
                } else {
                    versionToUse = incrementVersion(currentVersion, versionType.value);
                }
                
                if (!updatePluginVersion(pluginXmlPath, versionToUse)) {
                    vscode.window.showErrorMessage('Failed to update version in plugin.xml');
                    return;
                }
                
                vscode.window.showInformationMessage(`Updated plugin.xml version to ${versionToUse}`);
            }
            
            // Get plugin name from plugin.xml
            let pluginName = 'plugin';
            try {
                const xmlContent = fs.readFileSync(pluginXmlPath, 'utf8');
                const nameMatch = xmlContent.match(/name="([^"]+)"/);
                if (nameMatch) {
                    pluginName = nameMatch[1].toLowerCase().replace(/[^a-z0-9-]/g, '-');
                }
            } catch (error) {
                // Use default name
            }
            
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
            
            if (!editedPluginName) return;
            pluginName = editedPluginName;
            
            // Get directories to include
            const potentialDirs = [
                'web_root', 'WEB_ROOT',
                'queries_root', 'QUERIES_ROOT',
                'permissions_root', 'PERMISSIONS_ROOT',
                'MessageKeys', 'messagekeys',
                'pagecataloging', 'PageCataloging'
            ];
            
            const pluginRoot = pathUtils.getPluginFilesRoot();
            const dirsToInclude = potentialDirs.filter(dir => {
                const dirPath = path.join(pluginRoot, dir);
                return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
            });
            
            // Remove duplicates
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
                    'No standard plugin directories found (web_root, queries_root, permissions_root, MessageKeys, pagecataloging).\\n\\n' +
                    'Continue with just plugin.xml?',
                    'Continue',
                    'Cancel'
                );
                
                if (continueAnyway !== 'Continue') return;
            }
            
            const itemsList = ['plugin.xml', ...uniqueDirs].join('\\n  • ');
            const confirmPackage = await vscode.window.showInformationMessage(
                `📦 Package plugin v${versionToUse}?\\n\\nWill include:\\n  • ${itemsList}`,
                'Package',
                'Cancel'
            );
            
            if (confirmPackage !== 'Package') return;
            
            vscode.window.showInformationMessage('Creating plugin package...');
            const zipFilePath = await createPluginZip(pluginName, versionToUse, uniqueDirs);
            
            const zipFileName = path.basename(zipFilePath);
            const openFolder = await vscode.window.showInformationMessage(
                `✅ Plugin packaged successfully!\\n\\n${zipFileName}\\n\\nReady to install in PowerSchool.`,
                'Show in Folder',
                'OK'
            );
            
            if (openFolder === 'Show in Folder') {
                vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(zipFilePath));
            }
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to package plugin: ${error.message}`);
        }
    }));

    return commands;
}

function registerSnippetCommands(context, api, treeProvider) {
    const registerCommandSafely = (commandId, callback) => {
        try {
            return vscode.commands.registerCommand(commandId, callback);
        } catch (error) {
            return { dispose: () => {} };
        }
    };
    
    const commands = [];
    
    // Insert snippet command
    commands.push(registerCommandSafely('ps-vscode-cpm.insertSnippet', async () => {
        try {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showErrorMessage('No active text editor found. Please open a file first.');
                return;
            }

            const snippetsByCategory = getSnippetsByCategory();
            const snippetOptions = [];
            
            Object.keys(snippetsByCategory).forEach(category => {
                snippetOptions.push({
                    label: `── ${category} Snippets ──`,
                    description: '',
                    kind: vscode.QuickPickItemKind.Separator
                });
                
                snippetsByCategory[category].forEach(snippetInfo => {
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

            const selectedSnippet = await vscode.window.showQuickPick(snippetOptions, {
                placeHolder: 'Select a PowerSchool code snippet to insert',
                matchOnDescription: true,
                matchOnDetail: true
            });

            if (!selectedSnippet || selectedSnippet.kind === vscode.QuickPickItemKind.Separator) {
                return;
            }

            const position = editor.selection.active;
            await editor.edit(editBuilder => {
                editBuilder.insert(position, selectedSnippet.snippetContent);
            });

            vscode.window.showInformationMessage(`Inserted "${selectedSnippet.label}" snippet at cursor position.`);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to insert snippet: ${error.message}`);
        }
    }));

    // Individual snippet commands
    const snippetKeys = ['box_round', 'calendar', 'dialog', 'dynamic_tabs', 'jquery_function', 'form', 'table', 'tlist_sql', 'collapsible_box', 'if_block', 'student_info', 'breadcrumb'];
    
    snippetKeys.forEach(key => {
        commands.push(registerCommandSafely(`ps-vscode-cpm.insertSnippet.${key}`, async () => {
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

                const position = editor.selection.active;
                await editor.edit(editBuilder => {
                    editBuilder.insert(position, snippet.content);
                });

                vscode.window.showInformationMessage(`Inserted "${snippet.name}" snippet at cursor position.`);

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to insert snippet: ${error.message}`);
            }
        }));
    });

    // Individual template commands
    const templateKeys = ['admin', 'adminStudentPage', 'teacher', 'teacherBackpack', 'parentPortal'];
    
    templateKeys.forEach(key => {
        commands.push(registerCommandSafely(`ps-vscode-cpm.createTemplate.${key}`, async () => {
            try {
                const template = getTemplate(key);
                if (!template) {
                    vscode.window.showErrorMessage(`Template '${key}' not found.`);
                    return;
                }

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

                const remotePath = `${targetPath}/${fileName}`;
                const pluginFilesRoot = global.powerschoolCpmTreeProvider?.localRootPath || pathUtils.getPluginFilesRoot();
                if (!pluginFilesRoot) {
                    vscode.window.showErrorMessage('No workspace folder is open. Please open a folder first.');
                    return;
                }
                const localFilePath = path.join(pluginFilesRoot, remotePath.replace(/^\/+/g, ''));

                const localDir = path.dirname(localFilePath);
                if (!fs.existsSync(localDir)) {
                    fs.mkdirSync(localDir, { recursive: true });
                }

                fs.writeFileSync(localFilePath, template.content);

                const document = await vscode.workspace.openTextDocument(localFilePath);
                await vscode.window.showTextDocument(document);

                vscode.window.showInformationMessage(`Created ${fileName} from ${template.name} template. Edit and use "Publish to PowerSchool" when ready.`);

            } catch (error) {
                vscode.window.showErrorMessage(`Failed to create template: ${error.message}`);
            }
        }));
    });

    return commands;
}

module.exports = {
    registerCommands,
    registerFileCommands,
    registerPluginCommands,
    registerSnippetCommands,
    findFirstDifference
};