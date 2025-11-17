# Plugin File Mapping Setup

## Overview
Phase 2 of the custom file indicators feature requires a PowerSchool Named Query to map files to their owning plugins. This enables the extension to distinguish between:

- **Plugin-controlled custom files** (purple/magenta icons)
- **Custom files not in plugins** (blue/orange icons)
- **Original PowerSchool files** (green/cloud icons)

## Installation Steps

### Option 1: Add to Existing ps-vscode-cpm Plugin

If you already have the ps-vscode-cpm plugin installed in PowerSchool:

1. Add the `queries_root` directory to your plugin structure:
   ```
   ps-vscode-cpm-plugin/
   ├── plugin.xml
   ├── permissions_root/
   └── queries_root/          ← Add this
       └── com.tulsaschools.ps-vscode-cpm.named_queries.xml
   ```

2. Update `plugin.xml` version number (e.g., from 1.0.0 to 1.1.0)

3. Re-package and re-install the plugin in PowerSchool

### Option 2: Create Standalone Named Query Plugin

Create a minimal plugin just for the named query:

1. Create this directory structure:
   ```
   ps-vscode-cpm-queries/
   ├── plugin.xml
   └── queries_root/
       └── com.tulsaschools.ps-vscode-cpm.named_queries.xml
   ```

2. Create `plugin.xml`:
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <plugin xmlns="http://plugin.powerschool.pearson.com"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xsi:schemaLocation="http://plugin.powerschool.pearson.com plugin.xsd"
           name="ps-vscode-cpm-queries"
           version="1.0.0"
           description="Named queries for ps-vscode-cpm extension plugin file mapping">
   </plugin>
   ```

3. Package as ZIP and install via Plugin Management Dashboard

### Option 3: Manual Installation via PowerSchool UI

1. Go to **System Administrator** > **System Settings** > **Data Management** > **Manage Named Queries**
2. Click **New**
3. Enter:
   - **Name**: `org.tulsaschools.plugin.file.mappings`
   - **Description**: Maps PowerSchool CPM files to their owning plugins
   - **Core Table**: `psm_asset`
   - **Flattened**: Yes
4. Copy the SQL from `queries_root/com.tulsaschools.ps-vscode-cpm.named_queries.xml`
5. Add columns as specified in the XML file
6. Save

## Verification

After installation, test the named query:

1. In PowerSchool, go to **System Administrator** > **System Settings** > **Data Management** > **Manage Named Queries**
2. Find `org.tulsaschools.plugin.file.mappings`
3. Click **Execute**
4. You should see a list of all plugin files with their paths

## Extension Behavior

**With Named Query Installed:**
- Files are color-coded based on their plugin ownership
- Tooltips show plugin name and enabled status
- Three distinct file types are visible in the tree

**Without Named Query:**
- Extension gracefully degrades
- Shows only custom vs original distinction (Phase 1 features)
- No purple/magenta colors (plugin files show as blue/orange)
- Console shows: "⚠️ Plugin file mappings not available"

## Troubleshooting

### Query Returns No Results
- Verify plugins are installed in PowerSchool
- Check that plugins have files in the `web_root` directory
- Ensure plugins are enabled

### API Endpoint Returns 404
- Named query name must be exactly: `org.tulsaschools.plugin.file.mappings`
- Check query is active/enabled in PowerSchool

### Permission Denied
- Ensure the OAuth client or admin user has permission to execute named queries
- Add Data Management permissions if needed

## Color Legend

After installation, files will be color-coded as follows:

| Icon Color | File Type | Download Status |
|-----------|-----------|----------------|
| 🟣 Purple | Plugin-controlled custom | Downloaded locally |
| 🔴 Magenta | Plugin-controlled custom | Not downloaded |
| 🔵 Blue | Custom (no plugin) | Downloaded locally |
| 🟠 Orange | Custom (no plugin) | Not downloaded |
| 🟢 Green | Original PowerSchool | Downloaded locally |
| ☁️ Cloud Blue | Original PowerSchool | Not downloaded |

## SQL Query Details

The named query performs these joins:

1. **PLUGINDEF** - Plugin definitions table
2. **PLUGINDEFASSET** - Maps plugins to assets
3. **PSM_ASSET** - Asset files
4. **PSM_ASSETFOLDER** - Folder hierarchy (hierarchical query)

Returns columns:
- `pluginid` - Plugin ID
- `pluginname` - Plugin name
- `plugindescription` - Plugin description
- `pluginversion` - Plugin version
- `enabled` - Is plugin enabled (1 or 0)
- `filename` - File name
- `cpmpath` - Full CPM path (e.g., `/admin/custom.html`)
