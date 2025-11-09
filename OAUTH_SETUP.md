# PowerSchool CPM Plugin Setup Instructions

## OAuth Authentication Setup

The PowerSchool CPM VS Code extension uses OAuth for secure API access. Follow these steps to set up authentication:

### 1. Install PowerSchool Plugin

1. **Create Plugin ZIP**: Package the `plugin.xml` file into a ZIP archive
2. **Install in PowerSchool**: 
   - Login to PowerSchool Admin
   - Go to **System > System Settings > Plugin Management Dashboard**
   - Upload and install the plugin ZIP file
   - Enable the plugin

### 2. Get OAuth Credentials

After installing the plugin:

1. **Navigate to Plugin Management**:
   - System > System Settings > Plugin Management Dashboard
   - Find "PowerSchool CPM VSCode Extension"
   - Click to view details

2. **Copy Credentials**:
   - Copy the **Client ID**
   - Copy the **Client Secret**

### 3. Configure VS Code Extension

1. **Open VS Code Settings**: `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
2. **Search for "PowerSchool CPM"**
3. **Configure**:
   - **Server URL**: `https://your-powerschool-server.com`
   - **Client ID**: Paste the Client ID from PowerSchool
   - **Client Secret**: Paste the Client Secret from PowerSchool

### 4. Test Connection

1. **Open Command Palette**: `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. **Run**: "PowerSchool CPM: Test OAuth Connection"
3. **Verify**: Should show "OAuth connection successful!"

## Troubleshooting

### Error: "Must be logged in to access resource permission /ws/cpm/tree"

This error indicates one of the following issues:

#### Issue 1: CPM API Doesn't Support OAuth
The Custom Page Management API endpoints (`/ws/cpm/*`) may only support session-based authentication, not OAuth. 

**Solution**: Contact your PowerSchool administrator to:
- Verify if CPM APIs support OAuth authentication
- Check if additional API permissions need to be configured
- Ensure the plugin has proper access to CPM resources

#### Issue 2: Missing Plugin Permissions
The plugin may need additional permissions for CPM access.

**Solution**: Update the `plugin.xml` to include specific CPM permissions:
```xml
<access_request>
    <message>This plugin requires access to Custom Page Management APIs</message>
</access_request>
```

#### Issue 3: OAuth Scopes
The OAuth client may need specific scopes for CPM access.

**Solution**: Check with PowerSchool documentation for required OAuth scopes for CPM API access.

### Error: "OAuth authentication failed"

**Check**:
1. Server URL is correct (include https://)
2. Client ID and Secret are correct
3. PowerSchool plugin is installed and enabled
4. Network connectivity to PowerSchool server

### Testing Steps

1. **Test OAuth Connection**: Use the "Test OAuth Connection" command
2. **Check Console**: Open VS Code Developer Tools to see detailed error messages
3. **Verify Plugin**: Ensure the PowerSchool plugin is properly installed and enabled

## Alternative: Session-Based Authentication

If OAuth doesn't work for CPM APIs, the extension may need to be modified to use session-based authentication instead. This would require:

1. Web login simulation
2. Session cookie management
3. CSRF token handling

Contact the extension developer if OAuth continues to fail and session-based authentication is needed.