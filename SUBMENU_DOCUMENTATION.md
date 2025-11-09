# PowerSchool CPM Extension - Context Menu Submenu

## Overview
The PowerSchool CPM VS Code extension now features a hierarchical context menu with a submenu for code snippet insertion.

## Context Menu Structure

When you right-click in a PowerSchool file (.html, .htm, .js, .css, .txt), you'll see:

```
Right-click Context Menu:
├── Publish Current File
├── Publish Any File to PowerSchool  
└── Insert PowerSchool Snippet ►
    ├── Layout
    │   ├── Box Round Container
    │   └── Data Table
    ├── Forms  
    │   ├── Date Picker Widget
    │   └── PowerSchool Form
    ├── UI
    │   ├── Dialog Link
    │   ├── Dynamic Tabs
    │   └── Collapsible Box
    ├── JavaScript
    │   └── jQuery Function Block
    ├── PowerSchool
    │   ├── TList SQL Block
    │   ├── If/Else Block
    │   └── Student Info Tags
    └── Navigation
        └── Breadcrumb Navigation
```

## How It Works

### Submenu Configuration (package.json)
1. **Submenus Section**: Defines the submenu with ID `ps-vscode-cpm.snippets`
2. **Context Menu**: References the submenu instead of individual commands
3. **Submenu Items**: Organized by logical groups (layout, forms, ui, etc.)

### Command Structure
- **Main submenu command**: `ps-vscode-cpm.snippets`  
- **Individual snippet commands**: `ps-vscode-cpm.insertSnippet.{snippet_key}`

### Available Snippets
| Category | Snippet | Command Key | Description |
|----------|---------|-------------|-------------|
| Layout | Box Round Container | `box_round` | Standard PowerSchool content box |
| Layout | Data Table | `table` | Standards-compliant data table |
| Forms | Date Picker Widget | `calendar` | PowerSchool date picker input |
| Forms | PowerSchool Form | `form` | Standard form with submit button |
| UI | Dialog Link | `dialog` | Link that opens content in dialog |
| UI | Dynamic Tabs | `dynamic_tabs` | Tabbed content interface |
| UI | Collapsible Box | `collapsible_box` | Expandable content container |
| JavaScript | jQuery Function Block | `jquery_function` | jQuery wrapper for PowerSchool |
| PowerSchool | TList SQL Block | `tlist_sql` | Dynamic data query block |
| PowerSchool | If/Else Block | `if_block` | Conditional content block |
| PowerSchool | Student Info Tags | `student_info` | Common student information tags |
| Navigation | Breadcrumb Navigation | `breadcrumb` | Standard breadcrumb navigation |

## Usage Instructions

1. **Open any PowerSchool file** (.html, .htm, .js, .css, .txt)
2. **Right-click** in the editor where you want to insert a snippet
3. **Click "Insert PowerSchool Snippet"** to open the submenu
4. **Select the desired snippet** from the organized categories
5. **The snippet code will be inserted** at your cursor position

## Technical Implementation

### Submenu Definition
```json
"submenus": [
  {
    "id": "ps-vscode-cpm.snippets",
    "label": "Insert PowerSchool Snippet"  
  }
]
```

### Context Menu Integration
```json
"editor/context": [
  {
    "submenu": "ps-vscode-cpm.snippets",
    "when": "resourceExtname =~ /\\.(html|htm|js|css|txt)$/", 
    "group": "powerschool"
  }
]
```

### Individual Commands
Each snippet has its own command that directly inserts the code without showing a picker, making the submenu fast and efficient.

## Benefits

1. **Clean UI**: Single menu item that expands to show all options
2. **Organized**: Snippets grouped by logical categories  
3. **Fast Access**: Direct insertion without additional dialogs
4. **Contextual**: Only appears for relevant PowerSchool file types
5. **Extensible**: Easy to add new snippets by adding commands and menu items