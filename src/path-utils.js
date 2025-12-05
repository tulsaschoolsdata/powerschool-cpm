
// src/path-utils.js
// Centralized path and file operation utilities for PowerSchool CPM extension

const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

/**
 * Get the pluginFilesRoot (always includes web_root) for the current workspace.
 * @param {string} [workspaceRoot] - Optional workspace root path. If not provided, uses first workspace folder.
 * @returns {string|null}
 */
function getPluginFilesRoot(workspaceRoot) {
    if (!workspaceRoot) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) return null;
        workspaceRoot = folders[0].uri.fsPath;
    }
    // Always resolve to workspaceRoot/web_root
    return path.join(workspaceRoot, 'web_root');
}

/**
 * Given a PowerSchool remote path (e.g. /admin/tps_custom/file.html),
 * return the absolute local file path under web_root.
 * @param {string} remotePath
 * @param {string} [pluginFilesRoot]
 * @returns {string}
 */
function getLocalFilePathFromRemote(remotePath, pluginFilesRoot) {
    if (!pluginFilesRoot) pluginFilesRoot = getPluginFilesRoot();
    return path.join(pluginFilesRoot, remotePath.replace(/^\/+/g, ''));
}

/**
 * Given a local file path, return the PowerSchool remote path (with leading slash).
 * @param {string} localFilePath
 * @param {string} [pluginFilesRoot]
 * @returns {string}
 */
function getRemotePathFromLocal(localFilePath, pluginFilesRoot) {
    if (!pluginFilesRoot) pluginFilesRoot = getPluginFilesRoot();
    let rel = path.relative(pluginFilesRoot, localFilePath).replace(/\\/g, '/');
    if (!rel.startsWith('/')) rel = '/' + rel;
    return rel;
}

/**
 * Compare a remote PowerSchool path and a local file path for equivalence (after web_root).
 * @param {string} remotePath
 * @param {string} localFilePath
 * @param {string} [pluginFilesRoot]
 * @returns {boolean}
 */
function pathsMatch(remotePath, localFilePath, pluginFilesRoot) {
    if (!pluginFilesRoot) pluginFilesRoot = getPluginFilesRoot();
    const relServer = remotePath.replace(/^\/+/g, '');
    const relLocal = path.relative(pluginFilesRoot, localFilePath).replace(/\\/g, '/');
    return relServer === relLocal;
}

/**
 * Ensure the directory for a local file path exists, prompting the user if needed.
 * Returns true if the directory exists or was created, false if cancelled.
 * @param {string} localFilePath
 * @returns {Promise<boolean>}
 */
async function ensureLocalDir(localFilePath) {
    const localDir = path.dirname(localFilePath);
    if (!fs.existsSync(localDir)) {
        const createDir = await vscode.window.showWarningMessage(
            `Directory does not exist: ${localDir}\nCreate this directory?`,
            'Create Directory',
            'Cancel'
        );
        if (createDir === 'Create Directory') {
            fs.mkdirSync(localDir, { recursive: true });
            return true;
        } else {
            vscode.window.showInformationMessage('Operation cancelled.');
            return false;
        }
    }
    return true;
}

/**
 * Read file contents as UTF-8 string.
 * @param {string} localFilePath
 * @returns {string}
 */
function readFile(localFilePath) {
    return fs.readFileSync(localFilePath, 'utf8');
}

/**
 * Write file contents as UTF-8 string. Ensures directory exists.
 * @param {string} localFilePath
 * @param {string} content
 */
function writeFile(localFilePath, content) {
    const localDir = path.dirname(localFilePath);
    if (!fs.existsSync(localDir)) {
        fs.mkdirSync(localDir, { recursive: true });
    }
    fs.writeFileSync(localFilePath, content, 'utf8');
}

/**
 * Compare file contents with a string. Returns true if identical.
 * @param {string} localFilePath
 * @param {string} content
 * @returns {boolean}
 */
function compareFileContents(localFilePath, content) {
    if (!fs.existsSync(localFilePath)) return false;
    const fileContent = fs.readFileSync(localFilePath, 'utf8');
    return fileContent === content;
}

module.exports = {
    getPluginFilesRoot,
    getLocalFilePathFromRemote,
    getRemotePathFromLocal,
    pathsMatch,
    ensureLocalDir,
    readFile,
    writeFile,
    compareFileContents
};
