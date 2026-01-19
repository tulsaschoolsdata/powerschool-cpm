const vscode = require('vscode');
const { PowerSchoolAPI } = require('./modules/powerschool-api');
const { PowerSchoolTreeProvider } = require('./modules/tree-provider');
const {
    registerCommands,
    registerFileCommands,
    registerPluginCommands,
    registerSnippetCommands
} = require('./modules/commands');
const pathUtils = require('./modules/path-utils');
const {
    ServerInfoProvider,
    CommandsProvider,
    TemplatesProvider,
    SnippetsProvider
} = require('./modules/panel-providers');

function activate(context) {
    // Get workspace folder - use the first workspace folder as root
    let pluginFilesRoot = pathUtils.getPluginFilesRoot();

    // Initialize PowerSchool API and Tree Provider
    const api = new PowerSchoolAPI();
    api.initialize(); // Load configuration from VS Code settings

    // Set workspace state for persistent cache storage
    api.setWorkspaceState(context.workspaceState);

    const treeProvider = new PowerSchoolTreeProvider(api, pluginFilesRoot);

    // Register custom content provider for powerschool: scheme (for virtual document viewing)
    const powerschoolContentProvider = {
        provideTextDocumentContent: async (uri) => {
            // uri.path is the PowerSchool remote path
            const remotePath = uri.path;
            // Use API to fetch file content
            try {
                const content = await api.downloadFileContent(remotePath);
                return content || '';
            } catch (err) {
                return `Error loading remote file: ${err.message}`;
            }
        }
    };
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider('powerschool', powerschoolContentProvider)
    );
    
    // Store globally for cleanup
    global.powerschoolCpmTreeProvider = treeProvider;

    // Watch for workspace changes to update the tree provider
    const workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
        pluginFilesRoot = pathUtils.getPluginFilesRoot();
        treeProvider.localRootPath = pluginFilesRoot;
        treeProvider.refresh();
    });

    // Watch for configuration changes to update API settings
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ps-vscode-cpm')) {
            api.clearAuth();
            api.initialize();
            if (e.affectsConfiguration('ps-vscode-cpm.pluginWebRoot')) {
                pluginFilesRoot = pathUtils.getPluginFilesRoot();
                treeProvider.localRootPath = pluginFilesRoot;
            }
            treeProvider.refresh();
        }
    });

    // Watch for file saves to pre-fetch customContentId (improves publish performance)
    const fileSaveWatcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
        // Always get latest pluginFilesRoot
        const currentPluginFilesRoot = pathUtils.getPluginFilesRoot();
        if (!currentPluginFilesRoot || !document.fileName.startsWith(currentPluginFilesRoot)) {
            return;
        }
        // Calculate PowerSchool path using path-utils
        const remotePath = pathUtils.getRemotePathFromLocal(document.fileName, currentPluginFilesRoot);
        // Skip if not a PowerSchool file type
        if (!/\.(html|htm|js|css|txt)$/i.test(remotePath)) {
            return;
        }
        if (api.contentIdCache.has(remotePath)) {
            return;
        }
        api.downloadFileInfo(remotePath)
            .then(fileInfo => {
                // Pre-fetch customContentId for better publish performance
            })
            .catch(error => {
                // File doesn't exist on PowerSchool - that's fine
            });
    });

    // Initialize panel providers
    const serverInfoProvider = new ServerInfoProvider();
    const commandsProvider = new CommandsProvider();
    const templatesProvider = new TemplatesProvider();
    const snippetsProvider = new SnippetsProvider();
    
    // Watch for configuration changes to refresh server info panel
    const serverInfoConfigWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ps-vscode-cpm')) {
            serverInfoProvider.refresh();
        }
    });
    
    // Check if tree view already exists and dispose it
    if (global.powerschoolCpmTreeView) {
        try {
            global.powerschoolCpmTreeView.dispose();
        } catch (error) {
            // Silent cleanup
        }
        global.powerschoolCpmTreeView = null;
    }
    
    // Register the tree view with error handling
    let treeView;
    let serverInfoView;
    let commandsView;
    let templatesView;
    let snippetsView;
    
    try {
        treeView = vscode.window.createTreeView('ps-vscode-cpm-explorer', {
            treeDataProvider: treeProvider,
            showCollapseAll: true
        });

        // Store globally for cleanup
        global.powerschoolCpmTreeView = treeView;

        // Show server settings confirmation when panel is first opened
        let hasShownSettingsAlert = false;
        treeView.onDidChangeVisibility(async (e) => {
            if (e.visible && !hasShownSettingsAlert) {
                hasShownSettingsAlert = true;

                const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
                const serverUrl = config.get('serverUrl', '(not configured)') || '(not configured)';
                const pluginWebRoot = config.get('pluginWebRoot', 'web_root') || 'web_root';

                const choice = await vscode.window.showInformationMessage(
                    `PowerSchool CPM Settings:\n\nServer: ${serverUrl}\nPlugin Root: ${pluginWebRoot}`,
                    { modal: true },
                    'Continue',
                    'Change Settings'
                );

                if (choice === 'Change Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'ps-vscode-cpm');
                }
            }
        });
        
        // Register panel tree views
        serverInfoView = vscode.window.createTreeView('ps-vscode-cpm-server-info', {
            treeDataProvider: serverInfoProvider
        });
        
        commandsView = vscode.window.createTreeView('ps-vscode-cpm-commands', {
            treeDataProvider: commandsProvider
        });
        
        templatesView = vscode.window.createTreeView('ps-vscode-cpm-templates', {
            treeDataProvider: templatesProvider
        });
        
        snippetsView = vscode.window.createTreeView('ps-vscode-cpm-snippets', {
            treeDataProvider: snippetsProvider
        });
        
        // Register file decoration provider to color file/folder labels
        const fileDecorator = vscode.window.registerFileDecorationProvider({
            provideFileDecoration(uri) {
                const fileName = uri.path.split('/').pop();

                // Always color .txt files green (should only apply to files)
                if (fileName && fileName.endsWith('.txt')) {
                    return {
                        color: new vscode.ThemeColor('charts.green'),
                        tooltip: 'Text File'
                    };
                }

                // For custom URI schemes (files use this)
                if (uri.scheme === 'plugin') {
                    return {
                        color: new vscode.ThemeColor('symbolIcon.interfaceForeground'),
                        tooltip: 'Plugin File'
                    };
                } else if (uri.scheme === 'custom') {
                    return {
                        color: new vscode.ThemeColor('symbolIcon.classForeground'),
                        tooltip: 'Custom File'
                    };
                }

                // For folders with file:// scheme, check the decoration map
                if (uri.scheme === 'file' && treeProvider.folderDecorations && treeProvider.folderDecorations.size > 0) {
                    for (const [folderPath, decorationType] of treeProvider.folderDecorations) {
                        const normalizedFolderPath = folderPath.replace(/^\/+/g, '');
                        if (uri.path.endsWith(normalizedFolderPath)) {
                            if (decorationType === 'plugin') {
                                return {
                                    color: new vscode.ThemeColor('symbolIcon.interfaceForeground'),
                                    tooltip: 'Plugin Folder'
                                };
                            } else if (decorationType === 'custom') {
                                return {
                                    color: new vscode.ThemeColor('symbolIcon.classForeground'),
                                    tooltip: 'Custom Folder'
                                };
                            }
                        }
                    }
                }

                return undefined;
            }
        });
        context.subscriptions.push(fileDecorator);
        
    } catch (error) {
        vscode.window.showErrorMessage('PowerSchool CPM: Tree view registration failed. Please reload VS Code window.');
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
        serverInfoView,
        commandsView,
        templatesView,
        snippetsView,
        workspaceWatcher, 
        configWatcher,
        serverInfoConfigWatcher,
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
