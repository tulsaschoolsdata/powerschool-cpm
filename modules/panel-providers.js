const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

/**
 * Tree item for displaying info or clickable commands
 * @param {string} label
 * @param {string} contextValue
 * @param {object} [options]
 */
class PanelTreeItem extends vscode.TreeItem {
    constructor(label, contextValue, options = {}) {
        super(label, options.collapsibleState || vscode.TreeItemCollapsibleState.None);
        this.contextValue = contextValue;

        if (options.command) {
            this.command = options.command;
        }

        if (options.iconPath) {
            this.iconPath = options.iconPath;
        }

        if (options.description) {
            this.description = options.description;
        }

        if (options.tooltip) {
            this.tooltip = options.tooltip;
        }
    }
}

/**
 * Provider for Server Info panel - displays plugin web root, server URL, and username
 */
class ServerInfoProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /** @param {PanelTreeItem} element */
    getTreeItem(element) {
        return element;
    }

    /** @param {PanelTreeItem} element */
    getChildren(element) {
        if (element) {
            return [];
        }

        const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
        const serverUrl = config.get('serverUrl', 'Not configured');
        const username = config.get('username', 'Not configured');
        const pluginWebRoot = config.get('pluginWebRoot', 'web_root');

        const pathUtils = require('./path-utils');
        const pluginFilesRoot = pathUtils.getPluginFilesRoot();
        const items = [];
        items.push(new PanelTreeItem(
            `Server: ${serverUrl}`,
            'serverInfo',
            {
                iconPath: new vscode.ThemeIcon('server'),
                tooltip: `PowerSchool Server URL: ${serverUrl}`
            }
        ));
        items.push(new PanelTreeItem(
            `User: ${username}`,
            'serverInfo',
            {
                iconPath: new vscode.ThemeIcon('account'),
                tooltip: `PowerSchool Username: ${username}`
            }
        ));
        items.push(new PanelTreeItem(
            `Plugin Root: ${pluginFilesRoot ? path.basename(pluginFilesRoot) : '(none)'}`,
            'serverInfo',
            {
                iconPath: new vscode.ThemeIcon('folder'),
                tooltip: `Plugin Web Root: ${pluginFilesRoot || '(none)'}`,
                description: pluginWebRoot || '(workspace root)'
            }
        ));
        return items;
    }
}

/**
 * Returns true if at least one .json file exists anywhere under the plugin web root.
 * @returns {boolean}
 */
function hasJsonFilesInWebRoot() {
    const pathUtils = require('./path-utils');
    const root = pathUtils.getPluginFilesRoot();
    if (!root || !fs.existsSync(root)) return false;
    /** @param {string} dir */
    function check(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch (_) { return false; }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === 'pagecataloging') continue;
                if (check(path.join(dir, entry.name))) return true;
            } else if (entry.name.endsWith('.json')) {
                return true;
            }
        }
        return false;
    }
    return check(root);
}

/**
 * Provider for Commands panel - displays clickable command buttons
 */
class CommandsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;

        // Re-evaluate JSON availability when files are created/deleted or root changes
        vscode.workspace.onDidCreateFiles(e => {
            if (e.files.some(f => f.fsPath.endsWith('.json'))) this.refresh();
        });
        vscode.workspace.onDidDeleteFiles(e => {
            if (e.files.some(f => f.fsPath.endsWith('.json'))) this.refresh();
        });
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ps-vscode-cpm.pluginWebRoot')) this.refresh();
        });
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /** @param {PanelTreeItem} element */
    getTreeItem(element) {
        return element;
    }

    /** @param {PanelTreeItem} element */
    getChildren(element) {
        if (element) {
            return [];
        }

        const items = [];

        // File Commands
        items.push(new PanelTreeItem(
            'Create New File',
            'command',
            {
                iconPath: new vscode.ThemeIcon('new-file'),
                tooltip: 'Create a new PowerSchool file from template',
                command: {
                    command: 'ps-vscode-cpm.createNewFile',
                    title: 'Create New File'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Publish Current File',
            'command',
            {
                iconPath: new vscode.ThemeIcon('cloud-upload'),
                tooltip: 'Publish the currently open file to PowerSchool',
                command: {
                    command: 'ps-vscode-cpm.publishCurrentFile',
                    title: 'Publish Current File'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Show File Path Info',
            'command',
            {
                iconPath: new vscode.ThemeIcon('info'),
                tooltip: 'Show local and PowerSchool paths for current file',
                command: {
                    command: 'ps-vscode-cpm.showCurrentFilePath',
                    title: 'Show File Path Info'
                }
            }
        ));

        // Plugin Commands
        items.push(new PanelTreeItem(
            'Package Plugin as ZIP',
            'command',
            {
                iconPath: new vscode.ThemeIcon('package'),
                tooltip: 'Package the plugin for PowerSchool installation',
                command: {
                    command: 'ps-vscode-cpm.packagePlugin',
                    title: 'Package Plugin'
                }
            }
        ));

        // Settings & Connection
        const jsonAvailable = hasJsonFilesInWebRoot();
        items.push(new PanelTreeItem(
            'Test JSON Endpoint',
            'command',
            {
                iconPath: new vscode.ThemeIcon(
                    'json',
                    jsonAvailable ? undefined : new vscode.ThemeColor('disabledForeground')
                ),
                tooltip: jsonAvailable
                    ? 'Test JSON endpoints found in the plugin web root'
                    : 'No .json files found in the plugin web root',
                description: jsonAvailable ? undefined : 'no .json files',
                command: {
                    command: jsonAvailable ? 'ps-vscode-cpm.testJsonEndpoint' : 'ps-vscode-cpm.noJsonFiles',
                    title: 'Test JSON Endpoint'
                }
            }
        ));

        return items;
    }
}

/**
 * Provider for Templates panel - displays available page templates
 */
class TemplatesProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /** @param {PanelTreeItem} element */
    getTreeItem(element) {
        return element;
    }

    /** @param {PanelTreeItem} element */
    getChildren(element) {
        if (element) {
            return [];
        }

        const items = [];

        // Admin Templates
        items.push(new PanelTreeItem(
            'Admin Page',
            'template',
            {
                iconPath: new vscode.ThemeIcon('file-code'),
                tooltip: 'Create a general admin page',
                description: 'Admin',
                command: {
                    command: 'ps-vscode-cpm.createTemplate.admin',
                    title: 'Admin Page'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Admin Student Page',
            'template',
            {
                iconPath: new vscode.ThemeIcon('file-code'),
                tooltip: 'Create an admin page for student-specific functions',
                description: 'Admin',
                command: {
                    command: 'ps-vscode-cpm.createTemplate.adminStudentPage',
                    title: 'Admin Student Page'
                }
            }
        ));

        // Teacher Templates
        items.push(new PanelTreeItem(
            'Teacher Page',
            'template',
            {
                iconPath: new vscode.ThemeIcon('file-code'),
                tooltip: 'Create a general teacher page',
                description: 'Teacher',
                command: {
                    command: 'ps-vscode-cpm.createTemplate.teacher',
                    title: 'Teacher Page'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Teacher Backpack Page',
            'template',
            {
                iconPath: new vscode.ThemeIcon('file-code'),
                tooltip: 'Create a teacher backpack (student-specific) page',
                description: 'Teacher',
                command: {
                    command: 'ps-vscode-cpm.createTemplate.teacherBackpack',
                    title: 'Teacher Backpack Page'
                }
            }
        ));

        // Parent Templates
        items.push(new PanelTreeItem(
            'Parent Portal Page',
            'template',
            {
                iconPath: new vscode.ThemeIcon('file-code'),
                tooltip: 'Create a parent/guardian portal page',
                description: 'Parent',
                command: {
                    command: 'ps-vscode-cpm.createTemplate.parentPortal',
                    title: 'Parent Portal Page'
                }
            }
        ));

        return items;
    }
}

/**
 * Provider for Snippets panel - displays available code snippets
 */
class SnippetsProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }

    /** @param {PanelTreeItem} element */
    getTreeItem(element) {
        return element;
    }

    /** @param {PanelTreeItem} element */
    getChildren(element) {
        if (element) {
            return [];
        }

        const items = [];

        // Layout Snippets
        items.push(new PanelTreeItem(
            'Box Round Container',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('symbol-class'),
                tooltip: 'Insert a standard PowerSchool rounded content box',
                description: 'Layout',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.box_round',
                    title: 'Box Round'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Data Table',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('table'),
                tooltip: 'Insert a standards-compliant data table',
                description: 'Layout',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.table',
                    title: 'Data Table'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Collapsible Box',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('fold'),
                tooltip: 'Insert an expandable/collapsible content container',
                description: 'UI',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.collapsible_box',
                    title: 'Collapsible Box'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Dynamic Tabs',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('browser'),
                tooltip: 'Insert a tabbed content interface',
                description: 'UI',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.dynamic_tabs',
                    title: 'Dynamic Tabs'
                }
            }
        ));

        // Navigation Snippets
        items.push(new PanelTreeItem(
            'Navigation Block',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('list-tree'),
                tooltip: 'Insert a Page Catalog navigation block with links',
                description: 'Navigation',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.navigation_block',
                    title: 'Navigation Block'
                }
            }
        ));

        // Forms Snippets
        items.push(new PanelTreeItem(
            'PowerSchool Form',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('symbol-field'),
                tooltip: 'Insert a standard PowerSchool form with submit button',
                description: 'Forms',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.form',
                    title: 'Form'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Date Picker Widget',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('calendar'),
                tooltip: 'Insert a PowerSchool date picker input field',
                description: 'Forms',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.calendar',
                    title: 'Calendar'
                }
            }
        ));

        // PowerSchool-Specific
        items.push(new PanelTreeItem(
            'TList SQL Block',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('database'),
                tooltip: 'Insert a PowerSchool TList SQL query block',
                description: 'PowerSchool',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.tlist_sql',
                    title: 'TList SQL'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'If/Else Block',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('symbol-boolean'),
                tooltip: 'Insert a PowerSchool conditional block',
                description: 'PowerSchool',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.if_block',
                    title: 'If/Else'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Student Info Tags',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('person'),
                tooltip: 'Insert common PowerSchool student information tags',
                description: 'PowerSchool',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.student_info',
                    title: 'Student Info'
                }
            }
        ));

        // JavaScript
        items.push(new PanelTreeItem(
            'jQuery Function Block',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('symbol-method'),
                tooltip: 'Insert a standard jQuery function wrapper',
                description: 'JavaScript',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.jquery_function',
                    title: 'jQuery Function'
                }
            }
        ));

        // Navigation
        items.push(new PanelTreeItem(
            'Breadcrumb Navigation',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('arrow-right'),
                tooltip: 'Insert a standard PowerSchool breadcrumb navigation',
                description: 'Navigation',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.breadcrumb',
                    title: 'Breadcrumb'
                }
            }
        ));

        items.push(new PanelTreeItem(
            'Dialog Link',
            'snippet',
            {
                iconPath: new vscode.ThemeIcon('link'),
                tooltip: 'Insert a link that opens content in a dialog window',
                description: 'UI',
                command: {
                    command: 'ps-vscode-cpm.insertSnippet.dialog',
                    title: 'Dialog Link'
                }
            }
        ));

        return items;
    }
}

module.exports = {
    ServerInfoProvider,
    CommandsProvider,
    TemplatesProvider,
    SnippetsProvider
};
