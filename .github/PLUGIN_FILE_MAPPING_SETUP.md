# Plugin File Mapping Setup

## Overview

The PowerSchool CPM extension builds a file tree and enables file management through a hybrid authentication system that combines OAuth and session-based authentication. The system retrieves plugin metadata from a server-generated JSON file to provide enhanced file classification and visualization.

## Architecture Overview

### File Tree Structure

The extension displays the PowerSchool customization file hierarchy in VS Code's Explorer view. Files are classified and color-coded into three categories:

- **Plugin-controlled custom files** (Blue when downloaded, Orange when not)
- **Custom files not in plugins** (Blue when downloaded, Orange when not) 
- **Original PowerSchool files** (Gray when downloaded, Gray cloud icon when not)

### Hybrid Authentication System

The extension uses **two authentication methods** depending on the endpoint being accessed:

#### OAuth Authentication (Primary)
- **Used for**: PowerSchool REST API endpoints (`/ws/v1/*`, `/ws/schema/*`, general API calls)
- **Credentials**: Client ID and Client Secret
- **Token Type**: Bearer token with automatic refresh
- **Configuration**: `ps-vscode-cpm.clientId` and `ps-vscode-cpm.clientSecret`

#### Session Authentication (Secondary)
- **Used for**: CPM endpoints (`/ws/cpm/*`), PowerQuery endpoints (`/ws/schema/query/*`), and admin pages (`/admin/*`)
- **Credentials**: Username and Password (PowerSchool admin account)
- **Method**: Cookie-based session with automatic re-login
- **Configuration**: `ps-vscode-cpm.username` and `ps-vscode-cpm.password`

The system automatically selects the appropriate authentication method based on the endpoint being accessed.

## Data Sources and File Tree Construction

### 1. PowerSchool CPM Tree API (Session Auth)
**Endpoint**: `/ws/cpm/tree`

Used to build the folder and file hierarchy. This endpoint:
- Returns folder structure with subfolders and pages
- Provides the `custom` flag for each file (true = customized, false = original)
- Requires session authentication (admin credentials)

**Example Request**:
```
GET /ws/cpm/tree?path=/&maxDepth=1
Cookie: JSESSIONID=xxx; PS_TOKENID=yyy
```

**Returns**:
```json
{
  "folder": {
    "subFolders": [
      { "text": "admin", "custom": false }
    ],
    "pages": [
      { "text": "custom.html", "custom": true }
    ]
  }
}
```

### 2. Plugin Mappings JSON File (Session Auth)
**Endpoint**: `/admin/tps_custom/plugin_data.json`

This is a **server-generated JSON file** created using a PowerSchool custom page template with `tlist_sql` tags. The file:
- Contains plugin ownership metadata for custom files
- Is accessed directly as an HTTP endpoint (not through `/ws/cpm/builtintext`)
- Requires session authentication
- Updates dynamically based on installed plugins

**File Format**:
```json
{
  "/admin/custom.html": {
    "plugin": "MyPlugin",
    "enabled": true
  },
  "/admin/tools/report.html": {
    "plugin": "ReportingTools",
    "enabled": true
  }
}
```

The extension loads this file once per session and uses it to:
- Add plugin name to file tooltips
- Indicate plugin enabled/disabled status
- Enhance file classification beyond the basic custom/original distinction

### 3. File Content Operations (Session Auth)

**Download Files**:
- **Endpoint**: `/ws/cpm/builtintext?path=/admin/custom.html&LoadFolderInfo=false`
- **Method**: GET with session cookies
- **Returns**: JSON with `customPageContent` property containing file content

**Upload Files**:
- **Endpoint**: `/ws/cpm/customPageContent`
- **Method**: POST with multipart/form-data
- **Authentication**: Session cookies
- **Requires**: customContentId (0 for new files, actual ID for updates)

The extension maintains an in-memory cache of `customContentId` values for faster uploads.

## Plugin Data JSON Setup

### Creating the Server-Side JSON File

The plugin metadata comes from a PowerSchool custom page template that executes SQL and outputs JSON:

1. **File Location**: `/admin/tps_custom/plugin_data.json`
2. **File Type**: Custom page template (HTML/JSON)
3. **Content Type**: Uses `~[content_type:application/json]` tag
4. **Data Source**: SQL query using `tlist_sql` tags

**Template Structure**:
```html
~[content_type:application/json]
{
~[tlist_sql;
  SELECT 
    pda.webpath as path,
    pd.name as plugin,
    pd.plugin_enabled as enabled
  FROM plugindefasset pda
  JOIN plugindef pd ON pda.plugindefid = pd.id
  WHERE pda.webpath IS NOT NULL
  ORDER BY pda.webpath
]
  "~[path]": {
    "plugin": "~[plugin]",
    "enabled": ~[if.enabled=1]true~[else]false~[/if]
  }~[if.^last],~[/if]
~[/tlist_sql]
}
```

### Installation Options

#### Option 1: Add to Existing Plugin

If you have a PowerSchool plugin installed:

1. Create `/admin/tps_custom/plugin_data.json` in your plugin's `web_root`:
   ```
   my-plugin/
   ├── plugin.xml
   ├── web_root/
   │   └── admin/
   │       └── tps_custom/
   │           └── plugin_data.json
   ```

2. Add the JSON template content shown above

3. Re-package and reinstall the plugin

#### Option 2: Manual File Creation

1. Log into PowerSchool as System Administrator
2. Navigate to **System Administrator** > **System Settings** > **Custom Pages**
3. Create new custom page:
   - **Name**: `plugin_data.json`
   - **Path**: `/admin/tps_custom/`
   - **Content**: Use the template structure above
4. Save and publish

#### Option 3: Use CPM to Upload

1. Create the file locally with the template content
2. Use the extension's "Publish File" command to upload to `/admin/tps_custom/plugin_data.json`

## Extension Behavior

### With Plugin Data JSON Available

- File tooltips show: "filename (Plugin: PluginName)" or "filename (Plugin: PluginName - Disabled)"
- Custom files are properly attributed to their owning plugins
- Enhanced debugging information for plugin-controlled files

### Without Plugin Data JSON

- Extension operates normally with reduced metadata
- Files still classified as custom vs. original based on CPM tree API
- Tooltips show: "filename (Custom)" or "filename (Original PowerSchool)"
- No plugin attribution available

## Configuration Settings

All settings are in VS Code under `ps-vscode-cpm`:

### Required Settings

```json
{
  "ps-vscode-cpm.serverUrl": "https://powerschool.example.com",
  "ps-vscode-cpm.clientId": "your-oauth-client-id",
  "ps-vscode-cpm.clientSecret": "your-oauth-client-secret",
  "ps-vscode-cpm.username": "admin-username",
  "ps-vscode-cpm.password": "admin-password"
}
```

### Optional Settings

```json
{
  "ps-vscode-cpm.authMethod": "hybrid"  // Options: "oauth", "session", "hybrid" (default)
}
```

## Authentication Flow Details

### OAuth Flow (for REST API)
1. Extension checks if access token is valid (not expired)
2. If expired or missing, requests new token from `/oauth/access_token`
3. Uses client credentials grant type
4. Stores token and expiry timestamp
5. Automatically refreshes before expiration

### Session Flow (for CPM/Admin Pages)
1. Extension checks if session is valid (checked every 5 minutes)
2. If invalid, performs login sequence:
   - GET `/admin/pw.html` to obtain session cookies
   - POST credentials to `/admin/home.html`
   - Stores session cookies for subsequent requests
3. Session validity checked by accessing `/admin/customization/home.html`
4. Automatic re-login on session expiration

### Hybrid Mode (Default)
The extension automatically routes requests:
- `/ws/cpm/*` → Session auth
- `/ws/schema/query/*` → Session auth  
- `/admin/*` → Session auth
- All other `/ws/*` endpoints → OAuth

## File Operations

### Downloading Files
1. User clicks file in tree view
2. Extension calls `/ws/cpm/builtintext` with session auth
3. Parses JSON response and extracts `customPageContent`
4. Writes content to local workspace folder
5. Opens file in VS Code editor
6. Pre-caches `customContentId` for faster future uploads

### Uploading Files
1. User saves file or uses "Publish File" command
2. Extension checks cache for `customContentId`:
   - **Cache hit**: Uses cached ID immediately
   - **Cache miss**: Fetches file info from server to get ID
   - **New file**: Uses `customContentId: 0`
3. Constructs multipart/form-data with file content
4. POSTs to `/ws/cpm/customPageContent` with session auth
5. Updates cache with new `customContentId` if applicable

## Troubleshooting

### Plugin Data Not Loading
- Verify `/admin/tps_custom/plugin_data.json` is accessible
- Check JSON syntax is valid (no trailing commas)
- Ensure admin credentials have permission to access `/admin/*` paths
- Check VS Code Output panel (PowerSchool CPM) for error messages

### Authentication Failures
- **OAuth errors**: Verify Client ID and Secret are correct, check plugin permissions
- **Session errors**: Verify username/password, ensure admin account is active
- Check that credentials have appropriate PowerSchool permissions

### File Tree Not Loading
- Verify `ps-vscode-cpm.serverUrl` is correct (no trailing slash)
- Check network connectivity to PowerSchool server
- Ensure workspace folder is open in VS Code
- Check that CPM API endpoints are accessible

## Color and Icon Legend

| Icon | File Status | Description |
|------|-------------|-------------|
| 🔵 Blue file | Custom, Downloaded | Custom file exists locally |
| 🟠 Orange file | Custom, Not Downloaded | Custom file only on server |
| ⚪ Gray file | Original, Downloaded | Original PS file exists locally |
| ☁️ Gray cloud | Original, Not Downloaded | Original PS file only on server |
| 🟠 Orange folder | Contains Custom Files | Folder has custom files within |
| ⚪ Gray folder | All Original Files | Folder contains only original files |

## API Endpoint Reference

### OAuth Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/oauth/access_token` | POST | Obtain OAuth bearer token |

### Session-Authenticated Endpoints  
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/admin/pw.html` | GET | Get login cookies |
| `/admin/home.html` | POST | Submit login credentials |
| `/admin/customization/home.html` | GET | Verify session validity |
| `/ws/cpm/tree` | GET | Get folder/file tree structure |
| `/ws/cpm/builtintext` | GET | Download file content |
| `/ws/cpm/customPageContent` | POST | Upload file content |
| `/admin/tps_custom/plugin_data.json` | GET | Get plugin metadata |

## Technical Notes

- **Content ID Caching**: The extension caches `customContentId` values in VS Code's workspace state to avoid unnecessary server lookups
- **Tree Caching**: Folder tree results are cached in memory to reduce API calls
- **Session Persistence**: Session cookies persist until expiration or VS Code restart
- **SSL Verification**: Currently disabled (`rejectUnauthorized: false`) for development environments
- **File Path Normalization**: All paths normalized to `/path/to/file.html` format for consistent lookups
