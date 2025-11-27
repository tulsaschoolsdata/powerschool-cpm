const vscode = require('vscode');
const { PowerSchoolAPI } = require('./src/powerschool-api');
const { PowerSchoolTreeProvider } = require('./src/tree-provider');
const { 
    registerCommands, 
    registerFileCommands, 
    registerPluginCommands, 
    registerSnippetCommands,
    getPluginFilesRoot 
} = require('./src/commands');

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
    
    // Set workspace state for persistent cache storage
    api.setWorkspaceState(context.workspaceState);
    
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

    // Watch for file saves to pre-fetch customContentId (improves publish performance)
    const fileSaveWatcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
        // Only process files in the workspace
        if (!pluginFilesRoot || !document.fileName.startsWith(pluginFilesRoot)) {
            return;
        }
        
        // Calculate PowerSchool path
        const path = require('path');
        const relativePath = path.relative(pluginFilesRoot, document.fileName);
        const remotePath = '/' + relativePath.replace(/\\/g, '/');
        
        // Skip if not a PowerSchool file type
        if (!/\.(html|htm|js|css|txt)$/i.test(remotePath)) {
            return;
        }
        
        // Check if already cached - if so, skip the slow API call
        if (api.contentIdCache.has(remotePath)) {
            console.log(`💾 File saved: ${path.basename(document.fileName)} (customContentId already cached)`);
            return;
        }
        
        // Pre-fetch customContentId in background (don't await - fire and forget)
        console.log(`💾 File saved: ${path.basename(document.fileName)}, pre-fetching customContentId...`);
        
        api.downloadFileInfo(remotePath)
            .then(fileInfo => {
                if (fileInfo?.activeCustomContentId) {
                    console.log(`✅ Pre-fetched customContentId: ${fileInfo.activeCustomContentId} for ${remotePath}`);
                } else {
                    console.log(`ℹ️ File ${remotePath} is new (not on PowerSchool yet)`);
                }
            })
            .catch(error => {
                // File doesn't exist on PowerSchool - that's fine
                console.log(`ℹ️ File ${remotePath} not found on PowerSchool (probably new)`);
            });
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
    
    
    // Register all commands using modular command registration
    const basicCommands = registerCommands(context, api, treeProvider);
    const fileCommands = registerFileCommands(context, api, treeProvider);
    const pluginCommands = registerPluginCommands(context, api, treeProvider);
    const snippetCommands = registerSnippetCommands(context, api, treeProvider);
    
    // Add all command disposables to context subscriptions
    context.subscriptions.push(
        treeView, 
        workspaceWatcher, 
        configWatcher,
        fileSaveWatcher,
        ...basicCommands,
        ...fileCommands,
        ...pluginCommands,
        ...snippetCommands
    );
    
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
