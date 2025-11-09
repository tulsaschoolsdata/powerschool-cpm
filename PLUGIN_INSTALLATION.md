# PowerSchool CPM Plugin Installation Guide

## Overview
This plugin enables OAuth access to PowerSchool's Custom Page Management (CPM) APIs for the VS Code extension.

## Installation Steps

### 1. Create Plugin Package
Create a ZIP file containing:
- `plugin.xml` (OAuth configuration)
- `permissions_root/ps-vscode-cpm.permission_mappings.xml` (API permissions)

### 2. Install in PowerSchool
1. **Login to PowerSchool Admin**
2. **Navigate to**: System > System Settings > Plugin Management Dashboard
3. **Upload**: Select the plugin ZIP file
4. **Install**: Follow the installation prompts
5. **Enable**: Make sure the plugin is enabled

### 3. Get OAuth Credentials
1. **Go to Plugin Details**: Click on "PowerSchool CPM VSCode Extension"
2. **OAuth Configuration**: Click to view OAuth settings
3. **Copy Credentials**:
   - Client ID
   - Client Secret

### 4. Configure VS Code Extension
1. **Open VS Code Settings**: Cmd+, (Mac) or Ctrl+, (Windows/Linux)
2. **Search**: "PowerSchool CPM"
3. **Configure**:
   - **Server URL**: `https://your-powerschool-server.com`
   - **Client ID**: Paste from PowerSchool
   - **Client Secret**: Paste from PowerSchool

### 5. Test Connection
1. **Command Palette**: Cmd+Shift+P (Mac) or Ctrl+Shift+P (Windows/Linux)
2. **Run**: "PowerSchool CPM: Test OAuth Connection"
3. **Verify**: Should show "OAuth connection successful!"

## Files in Plugin Package

### plugin.xml
- Declares OAuth requirements
- Requests API access permissions
- Publisher information

### permissions_root/ps-vscode-cpm.permission_mappings.xml
- Maps CPM API endpoints to admin pages
- Grants GET/POST/PUT/DELETE access to `/ws/cpm/*` endpoints
- Required for OAuth access to work

## Troubleshooting

### Permission Denied Errors
If you still get "Must be logged in" errors after installation:

1. **Verify Plugin Installation**: Make sure plugin is installed and enabled
2. **Check User Permissions**: Ensure your admin user has access to customization pages
3. **Review Permission Mappings**: The plugin grants access based on admin page permissions

### OAuth Connection Fails
1. **Check Credentials**: Verify Client ID and Secret are correct
2. **Server URL**: Ensure URL is correct and includes https://
3. **Network Access**: Verify VS Code can reach PowerSchool server

### API Access Issues
The permission mappings grant access to:
- `/ws/cpm/tree` - File/folder structure
- `/ws/cpm/builtintext` - File content operations

If these endpoints still fail, contact PowerSchool support to verify CPM API OAuth support.

## Security Notes

- OAuth credentials are more secure than username/password
- Client credentials should be kept confidential
- Plugin only requests minimum necessary permissions
- Access is scoped to CPM-related APIs only