# PowerSchool CPM Extension

A VS Code extension that provides seamless integration with PowerSchool's Custom Page Management (CPM) system. Browse, edit, publish, and manage your PowerSchool custom pages and plugin files directly from VS Code.

## Companion Plugin (Recommended)

For best results, install the companion PowerSchool plugin:

**[powerschool-cpm-plugin](https://github.com/zuvy/powerschool-cpm-plugin)**

The companion plugin provides meta data about PowerSchool plugins to enrich the file tree. With it installed, files owned by PowerSchool plugins will display the plugin name and enabled status in their tooltips, and will be color-coded differently from built-in CPM files. Without it the extension still works fully — file browsing, downloading, and publishing all operate through the standard CPM API regardless.

### Installing the Companion Plugin

1. Go to the [releases page](https://github.com/zuvy/powerschool-cpm-plugin/releases/tag/v0.1.0) and download the `vscode_cpm.zip` plugin file
2. Log in to your PowerSchool admin panel
3. Navigate to **System > System Settings > Plugin Management Configuration**
4. Click **Install** and upload the `.zip` file
5. Enable the plugin after installation

## Installing the VS Code Extension

### From a VSIX File

Download the latest `.vsix` file from the [releases](https://github.com/tulsaschoolsdata/powerschool-cpm/releases/tag/v5.0.0) page, then install it from the terminal:

```bash
code --install-extension ps-vscode-cpm-5.0.0.vsix
```

Replace `ps-vscode-cpm-5.0.0.vsix` with the actual filename you downloaded.

To verify the installation:

```bash
code --list-extensions | grep ps-vscode-cpm
```

## Requirements

- VS Code 1.104.0 or higher
- Access to a PowerSchool instance with Custom Page Management enabled
- A Service Account with admin access to Custom Page Management
- Network access to your PowerSchool server

## Setup

1. **Install the Extension** from a VSIX file (see above).
2. **Open your workspace**: Open your plugin folder in VS Code. For plugin development, the workspace will usually be your plugin root (the folder containing `plugin.xml` and `web_root/`).
3. **Configure Server Settings**: Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run `ps-vscode-cpm: Configure Server Settings`, or go to VS Code Settings and search for `ps-vscode-cpm`
4. **Set your Plugin Web Root**: Run `ps-vscode-cpm: Setup Plugin Web Root Directory` to tell the extension where your `web_root` or `query_root` and `plugin.xml` lives relative to the workspace

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `ps-vscode-cpm.serverUrl` | `""` | PowerSchool server URL (e.g., `https://pstest.yourschool.org`) |
| `ps-vscode-cpm.username` | `""` | PowerSchool admin username |
| `ps-vscode-cpm.password` | `""` | PowerSchool admin password |
| `ps-vscode-cpm.pluginWebRoot` | `"web_root"` | Path to `web_root` relative to workspace root |
| `ps-vscode-cpm.autoSync` | `true` | Automatically sync file tree when workspace opens |
| `ps-vscode-cpm.maxDepth` | `5` | Maximum folder depth to sync from PowerSchool |

### Plugin Web Root Options

| Value | Resolved Path |
|---|---|
| `""` | `<workspace>/` (workspace is the web root) |
| `"web_root"` | `<workspace>/web_root/` |
| `"src"` | `<workspace>/src/web_root/` |
| `"src/web_root"` | `<workspace>/src/web_root/` |

## Features

### Activity Bar Panel

Click the PowerSchool icon in the activity bar to access five panels:

- **PowerSchool Files** — Browse the remote file tree. Files are color-coded by type (built-in vs. custom)
- **Commands** — Quick access to common extension actions
- **Server Info** — View connection status and server details
- **Templates** — Insert pre-built page templates
- **Snippets** — Insert common PowerSchool code patterns

### File Operations

| Command | Description |
|---|---|
| **Download File** | Download a remote file to your local workspace |
| **Publish to PowerSchool** | Upload a local file to PowerSchool (inline button or context menu) |
| **Publish Current File** | Publish the file currently open in the editor |
| **Publish New File to PowerSchool** | Upload a new file that doesn't yet exist on the server |
| **Delete from PowerSchool** | Remove a custom file from the server |
| **Show File Path Info** | Display the resolved local and remote paths for the current file |

### Plugin Tools

| Command | Description |
|---|---|
| **Package Plugin as ZIP** | Package your plugin directory as a ZIP ready for PowerSchool import |
| **Setup Plugin Web Root Directory** | Configure which folder maps to `web_root` |
| **Configure Server Settings** | Open the settings UI for server URL and credentials |
| **Test JSON Endpoint** | Test a custom API endpoint on your PowerSchool server |
| **Refresh** | Reload the remote file tree |

### Page Templates

Quickly scaffold new pages via the **Templates** panel or Command Palette:

- Admin Page
- Admin Student Page
- Teacher Page
- Teacher Backpack Page
- Parent Portal Page

### Code Snippets

Insert common PowerSchool patterns via the **Snippets** panel or `ps-vscode-cpm: Insert Code Snippet`:

- Box-Round Div
- Date Picker Widget
- Dialog Link
- Dynamic Tabs
- jQuery Function Block
- PowerSchool Form
- Data Table
- TList SQL Block
- Collapsible Box
- If/Else Block
- Student Info Tags
- Breadcrumb Navigation

## How It Works

1. On workspace open, the extension reads your VS Code settings to locate the server and credentials
2. It authenticates with PowerSchool using your admin username and password
3. The remote CPM file tree is fetched and displayed in the **PowerSchool Files** panel
4. Local files are compared against the remote structure — icons indicate sync status
5. Editing and saving a file locally pre-fetches the remote content ID to speed up publishing
6. Publishing pushes the local file contents directly to PowerSchool via the CPM API

## Suggested Work Flow

 - For New Plugins
    1. Create the file structure and file stubs
    2. Install the basic plugin on PowerSchool
    3. Download the remote files instead of opening the local files (this caches the remote file id and insures a quicker publishing experience)

 - For Existing Plugins
    1. Ensure the plugin Web Root setting is correct
    2. Start with a clean workspace
    3. Download the files you need to work with from the PowerSchool Server.

## Directory Structure

For plugin development, your workspace should look like:

```
your-plugin/
├── plugin.xml
└── web_root/          # <-- set pluginWebRoot to "web_root"
    ├── admin/
    ├── guardian/
    ├── student/
    ├── teacher/
    └── ...
```

## Known Issues

- Binary files are not supported for upload; only text-based files can be published

---

**Enjoy seamless PowerSchool custom page development!**
