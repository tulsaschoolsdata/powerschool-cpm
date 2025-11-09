# PowerSchool CPM Extension - Template Submenu

## Overview
The PowerSchool CPM VS Code extension now features a hierarchical context menu with submenus for both code snippets AND template creation.

## Updated Context Menu Structure

When you right-click in a PowerSchool file (.html, .htm, .js, .css, .txt), you'll see:

```
Right-click Context Menu:
├── Publish Current File
├── Publish Any File to PowerSchool  
├── Insert PowerSchool Snippet ►
│   ├── Layout
│   │   ├── Box Round Container
│   │   └── Data Table
│   ├── Forms  
│   │   ├── Date Picker Widget
│   │   └── PowerSchool Form
│   ├── UI
│   │   ├── Dialog Link
│   │   ├── Dynamic Tabs
│   │   └── Collapsible Box
│   ├── JavaScript
│   │   └── jQuery Function Block
│   ├── PowerSchool
│   │   ├── TList SQL Block
│   │   ├── If/Else Block
│   │   └── Student Info Tags
│   └── Navigation
│       └── Breadcrumb Navigation
└── Create New PowerSchool File ►
    ├── Admin
    │   ├── Admin Page
    │   └── Admin Student Page
    ├── Teacher
    │   ├── Teacher Page
    │   └── Teacher Backpack Page
    └── Parent
        └── Parent Portal Page
```

## Template Creation Workflow

### Using the Context Menu Submenu
1. **Right-click** in any PowerSchool file (.html, .htm, .js, .css, .txt)
2. **Click "Create New PowerSchool File"** to open the template submenu
3. **Select the desired template** from the organized categories:
   - **Admin**: Admin Page, Admin Student Page
   - **Teacher**: Teacher Page, Teacher Backpack Page  
   - **Parent**: Parent Portal Page
4. **Enter a filename** when prompted (with proper extension validation)
5. **Select target directory** from common PowerSchool paths or enter custom path
6. **File is created locally** with template content and opened in editor
7. **Edit the file** as needed
8. **Use "Publish to PowerSchool"** when ready to deploy

### Template Creation Process
1. **Template Selection**: Choose from 5 pre-built PowerSchool page templates
2. **Filename Input**: Enter desired filename with automatic extension validation
3. **Path Selection**: Choose from common PowerSchool directories:
   - `/admin` - General admin pages
   - `/admin/students` - Student admin pages  
   - `/admin/teachers` - Teacher admin pages
   - `/admin/schools` - School admin pages
   - `/public` - Public pages
   - `/images/css` - CSS stylesheets
   - `/images/javascript` - JavaScript files
   - Custom path option for any other location
4. **Local Creation**: File created in local workspace with full template content
5. **Automatic Opening**: New file automatically opened in VS Code editor

## Available Templates

| Category | Template | Command Key | Description | Extension |
|----------|----------|-------------|-------------|-----------|
| Admin | Admin Page | `admin` | General admin page with header/navigation | `.html` |
| Admin | Admin Student Page | `adminStudentPage` | Admin page with student context | `.html` |
| Teacher | Teacher Page | `teacher` | Teacher portal page template | `.html` |
| Teacher | Teacher Backpack Page | `teacherBackpack` | Teacher backpack functionality page | `.html` |
| Parent | Parent Portal Page | `parentPortal` | Parent portal page template | `.html` |

## Template Features

### All Templates Include:
- ✅ **Proper DOCTYPE and HTML structure**
- ✅ **PowerSchool required scripts** (`~[wc:commonscripts]`)
- ✅ **Required stylesheets** (screen.css, print.css)
- ✅ **PowerSchool web components** (headers, navigation)
- ✅ **Breadcrumb navigation** placeholder
- ✅ **Content area** structure
- ✅ **PowerSchool-specific tags** and variables

### Template Categories:

#### **Admin Templates**
- **Admin Page**: General administrative page with full admin navigation
- **Admin Student Page**: Administrative page with student-specific context and data

#### **Teacher Templates**  
- **Teacher Page**: Teacher portal page with teacher-specific navigation and tools
- **Teacher Backpack Page**: Specialized page for teacher backpack functionality

#### **Parent Templates**
- **Parent Portal Page**: Parent portal page with parent-specific navigation and student data access

## Technical Implementation

### Submenu Configuration
```json
"submenus": [
  {
    "id": "ps-vscode-cpm.templates", 
    "label": "Create New PowerSchool File"
  }
]
```

### Individual Template Commands
```json
{
  "command": "ps-vscode-cpm.createTemplate.admin",
  "title": "Admin Page"
},
{
  "command": "ps-vscode-cpm.createTemplate.adminStudentPage", 
  "title": "Admin Student Page"
}
```

### Context Menu Integration  
```json
{
  "submenu": "ps-vscode-cpm.templates",
  "when": "resourceExtname =~ /\\.(html|htm|js|css|txt)$/",
  "group": "powerschool@2"
}
```

## Comparison: Templates vs Snippets

| Feature | Templates | Snippets |
|---------|-----------|----------|
| **Purpose** | Create complete new files | Insert code blocks into existing files |
| **Scope** | Full page structure | Small code fragments |
| **Workflow** | Filename → Path → Create file | Position cursor → Insert code |
| **Output** | New file in workspace | Code inserted at cursor |
| **Use Case** | Starting new PowerSchool pages | Adding functionality to existing pages |

## Benefits

### **Improved Efficiency**
- ✅ **No Command Palette**: Direct access via context menu
- ✅ **Visual Organization**: Templates grouped by logical categories  
- ✅ **Fast Creation**: Two clicks to start template creation process
- ✅ **Integrated Workflow**: Seamlessly integrates with existing publish functionality

### **Better User Experience**
- ✅ **Contextual**: Only appears for relevant PowerSchool file types
- ✅ **Organized**: Clear category separation (Admin, Teacher, Parent)
- ✅ **Intuitive**: Familiar right-click → submenu pattern
- ✅ **Consistent**: Matches the existing snippet submenu pattern

### **Development Benefits**
- ✅ **Standardized Templates**: Ensures consistent PowerSchool page structure
- ✅ **Required Elements**: All templates include necessary PowerSchool components  
- ✅ **Quick Start**: Skip manual setup of common PowerSchool page elements
- ✅ **Extension Ready**: Templates follow PowerSchool best practices and requirements

## Usage Examples

### Creating an Admin Student Page
1. Right-click in any PowerSchool file
2. Click "Create New PowerSchool File" → "Admin" → "Admin Student Page"
3. Enter filename: `student-demographics.html`
4. Select path: `/admin/students`
5. Edit the generated template with your specific content
6. Use "Publish to PowerSchool" to deploy

### Creating a Teacher Page
1. Right-click in any PowerSchool file  
2. Click "Create New PowerSchool File" → "Teacher" → "Teacher Page"
3. Enter filename: `grade-book.html`
4. Select path: `/admin/teachers` 
5. Customize the template for your grade book functionality
6. Publish when ready

This submenu approach provides the same efficiency and organization as the snippet submenu, but for complete file creation rather than code insertion.