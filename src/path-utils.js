

// src/path-utils.js
// Centralized path and file operation utilities for PowerSchool CPM extension

const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

/**
 * Get the pluginFilesRoot (always includes web_root) for the current workspace.
 * @returns {string|null}
 */
function getPluginFilesRoot() {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return null;
    const workspaceRoot = folders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration('ps-vscode-cpm');
    const pluginRootSetting = config.get('plugin_root', '');
    const pluginWebRootSetting = config.get('pluginWebRoot', 'web_root');

    // If plugin_root is set, use {workspaceRoot}/{plugin_root}/web_root
    if (pluginRootSetting) {
        const customWebRoot = path.join(workspaceRoot, pluginRootSetting, 'web_root');
        if (fs.existsSync(customWebRoot) && fs.statSync(customWebRoot).isDirectory()) {
            return customWebRoot;
        }
        // If only plugin_root exists, fallback to {workspaceRoot}/{plugin_root}
        const customRoot = path.join(workspaceRoot, pluginRootSetting);
        if (fs.existsSync(customRoot) && fs.statSync(customRoot).isDirectory()) {
            return customRoot;
        }
    }
    // If pluginWebRoot is set (and not handled above), use workspaceRoot/pluginWebRoot
    if (pluginWebRootSetting && (!pluginRootSetting || pluginWebRootSetting !== pluginRootSetting)) {
        const topLevelWebRoot = path.join(workspaceRoot, pluginWebRootSetting);
        if (fs.existsSync(topLevelWebRoot) && fs.statSync(topLevelWebRoot).isDirectory()) {
            return topLevelWebRoot;
        }
    }
    // Fallback: use workspace root
    return workspaceRoot;
}

/**
 * Given a PowerSchool remote path (with leading slash), return the local file path (always under pluginFilesRoot).
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
            `To download and open this file, the directory structure must be created:\n${localDir}\n\nCreate directory and download file?`,
            'Create & Download',
            'Cancel'
        );
        if (createDir === 'Create & Download') {
            fs.mkdirSync(localDir, { recursive: true });
            return true;
        } else {
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
