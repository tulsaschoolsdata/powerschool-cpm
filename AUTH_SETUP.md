# 🎯 PowerSchool CPM Hybrid Authentication Setup

- **OAuth for standard APIs** (like `/ws/v1/*`)
- **Session authentication for CPM APIs** (like `/ws/cpm/*`)

CPM endpoints appear to be "internal-only" APIs that don't support OAuth.

---

## 🔧 **Setup Steps**

### **Step 1: Configure Authentication Method**
1. **Access Plugin**: The ps-vscode-cpm extension requires a basic PowerSchool plugin with oauth to provide client id and secret + Access Level for v1 APIs set to full. Add the included query to your existing oauth plugin, or create a new one.
2. **Access Account**; The ps-vscode-cpm extension requires an active admin account.
  - **Suggestion**: Set up a service account specifically for this plugin.
4. Install the plugin.
5. **Open VS Code Settings**: `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
6. **Search**: "ps-vscode-cpm"
8. **Set Authentication Method**: Choose **"hybrid"**

### **Step 2: Configure Credentials**
You need **both** OAuth and session credentials:

#### **OAuth Credentials** (for standard APIs)
- **Server URL**: `https://your-powerschool-server.com`
- **Client ID**: From your PowerSchool plugin
- **Client Secret**: From your PowerSchool plugin

#### **Session Credentials** (for CPM APIs)  
- **Username**: Your PowerSchool admin username
- **Password**: Your PowerSchool admin password

### **Step 3: Test the Configuration**
1. **Command Palette**: `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
2. **Run**: "PowerSchool CPM: Test OAuth Connection"
3. **Expected Results**:
   ```
   ✅ Basic API: Working (oauth)
   ✅ CPM Tree: Working (session)
   🎉 Both basic API and CPM APIs are working!
   ```

---

## ⚙️ **Authenticatione**

### **1. Hybrid**
- **Standard APIs**: Uses OAuth (secure, token-based)
- **CPM APIs**: Uses session authentication (username/password)
- **Best of both worlds**: Secure where possible, functional for CPM

---

## 🔍 **How It Works**

### **Automatic Endpoint Detection**
The extension automatically chooses the right authentication:

```javascript
// CPM endpoints → Session authentication
/ws/cpm/tree
/ws/cpm/builtintext

// Standard APIs → OAuth authentication  
/ws/v1/time
/ws/v1/student
```
---

## 📋 **Complete Configuration Example**

```json
PowerSchool CPM Settings:
├── Server URL: "https://pstest.yourschool.org"
├── Auth Method: "hybrid"
├── Client ID: "Your client ID"  
├── Client Secret: "Your Client Secret"
├── Username: "Your PowerSchool admin account username"
└── Password: "Your PowerSchool admin account password"
```

---

## 🚀 **Expected Results After Setup**

```
✅ PowerSchool file tree loaded  
✅ CPM API endpoints accessible
✅ File download/upload
✅ Template creation
```

---

## 🔧 **Troubleshooting**

### **If CPM APIs Fail:**
1. **Check Username/Password**: Ensure admin credentials are correct
2. **Verify Admin Access**: User must have access to customization pages
3. **Test Manual Login**: Try logging into PowerSchool web interface

### **If OAuth APIs Fails:**
1. **Check Plugin Installation**: Ensure PowerSchool plugin is installed/enabled
2. **Verify Credentials**: Check Client ID and Secret are correct
3. **Test Standard APIs**: Run connection test to diagnose OAuth issues
