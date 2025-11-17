# PowerSchool CPM Extension

A VS Code extension that provides seamless integration with PowerSchool's Custom Page Management system. This extension syncs your current workspace directory with PowerSchool's file structure, making plugin development and management of custom pages easier.

## Features
- **PowerSchool API Integration**: Uses PowerSchool's CPM API to fetch folder structures
- **File System Management**: Saves files to local file structure and publishes them to PowerSchool to see real time changes
- **Configuration Options**: Customizable server URL, sync depth

## Requirements

- VS Code 1.104.0 or higher
- Access to a PowerSchool instance with Custom Page Management enabled
- Network access to your PowerSchool server

## Setup

1. **Install the Extension**: Install this extension in VS Code
2. **Configure Environment Variables**: See AUTH_SETUP.md
3. **Open Workspace**: Open any folder in VS Code to use as your PowerSchool development workspace
    When developing a plugin, web_root must be

## Extension Settings

This extension contributes the following settings:

* `ps-vscode-cpm.autoSync`: Enable/disable automatic sync when workspace opens (default: true)
* `ps-vscode-cpm.maxDepth`: Maximum folder depth to sync from PowerSchool (default: 5)

## Environment Configuration


* `TEST_SERVER_URI`: PowerSchool server URL (e.g., http://pstest.yourschool.org)
* `TEST_SERVER_CLIENT_ID`: PowerSchool OAuth client ID from basic oauth plugin.
* `TEST_SERVER_CLIENT_SECRET`: PowerSchool OAuth client secret from basic oauth plugin.

## Commands

Access these commands via the Command Palette (Ctrl+Shift+P): or the context Menu.

<img width="409" height="301" alt="image" src="https://github.com/user-attachments/assets/1d68bfd5-dc7c-4f68-8c11-98c2c5febfe1" />


## How It Works

1. **Detection**: When VS Code opens a workspace, the extension detects the file structure of the plugin.
3. **OAuth Authentication**: Authenticates with PowerSchool using client credentials flow
4. **API Call**: Fetches the folder tree structure from `/ws/cpm/tree` endpoint using Bearer token
5. **Comparison**: Compares remote structure with local directory

## PowerSchool API Integration

This extension uses PowerSchool's Custom Page Management API endpoints:

- `GET /ws/cpm/tree` - Retrieves folder/file structure
- `GET /ws/cpm/builtintext` - Gets file contents (future feature)
- Additional endpoints for full CRUD operations (planned)

## Directory Structure

```
your-workspace/          # Current workspace folder (synced with PowerSchool)
├── admin/               # Admin pages
├── guardian/            # Guardian portal pages  
├── student/             # Student portal pages
├── teacher/             # Teacher portal pages
├── ...                  # Other custom directories
└── .vscode/
    └── settings.json    # Workspace settings
```

## Known Issues

- **Environment Security**: Ensure `.env.local` is not committed to version control (add to .gitignore)
- **Binary Files**: Binary files are created as placeholder text files with metadata
- **SSL Certificates**: Self-signed certificates are accepted for development environments
- **Token Management**: OAuth tokens are automatically refreshed as needed

## Usage Example

1. Open any folder in VS Code as your workspace
2. Configure your PowerSchool server URL in settings
3. Click the PowerSchool icon in the activity bar to browse and sync files
4. Edit files locally, then publish them back to PowerSchool using the extension commands

## Future Features

- Direct file content synchronization
- Upload local changes to PowerSchool
- Real-time sync capabilities
- Better authentication handling
- Support for custom SSL certificates

## Development

This extension is built using:
- VS Code Extension API
- Node.js built-in modules (https, fs, path)
- PowerSchool Custom Page Management API

## Release Notes

### 0.0.1

Initial release with:
- Basic PowerSchool API integration
- Directory structure synchronization
- Configuration settings
- Auto-sync on workspace open

---

**Enjoy seamless PowerSchool custom page development!**
