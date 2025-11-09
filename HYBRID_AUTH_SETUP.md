# 🎯 PowerSchool CPM Hybrid Authentication Setup

## The Solution: Hybrid Authentication

Based on your error, I've created a **hybrid authentication system** that solves the CPM API access issue:

- **OAuth for standard APIs** (like `/ws/v1/*`)
- **Session authentication for CPM APIs** (like `/ws/cpm/*`)

This approach works because CPM endpoints appear to be "internal-only" APIs that don't support OAuth.

---

## 🔧 **Setup Steps**

### **Step 1: Configure Authentication Method**
1. **Open VS Code Settings**: `Cmd+,` (Mac) or `Ctrl+,` (Windows/Linux)
2. **Search**: "PowerSchool CPM"
3. **Set Authentication Method**: Choose **"hybrid"**

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

## ⚙️ **Authentication Methods Available**

### **1. Hybrid (Recommended)**
- **Standard APIs**: Uses OAuth (secure, token-based)
- **CPM APIs**: Uses session authentication (username/password)
- **Best of both worlds**: Secure where possible, functional for CPM

### **2. OAuth Only**
- Uses OAuth for all APIs
- **Pros**: Most secure
- **Cons**: CPM endpoints will fail (as you experienced)

### **3. Session Only**
- Uses username/password for all APIs  
- **Pros**: Works with all PowerSchool endpoints
- **Cons**: Less secure, stores passwords

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

### **Seamless Integration**
- **No manual switching needed**
- **Automatic fallback** to appropriate auth method
- **Single configuration** handles both types

---

## 📋 **Complete Configuration Example**

```json
PowerSchool CPM Settings:
├── Server URL: "https://pstest.yourschool.org"
├── Auth Method: "hybrid"
├── Client ID: "66fc77ee-359b-4f15-971e-8bd5d3e83fd7"  
├── Client Secret: "3260cf45-41c3-4f16-b8e3-8b120a4afc54"
├── Username: "admin"
└── Password: "your-admin-password"
```

---

## 🚀 **Expected Results After Setup**

### **Before (OAuth Only):**
```
❌ API Error 401: CPM API authentication failed
```

### **After (Hybrid Authentication):**
```
✅ PowerSchool file tree loaded  
✅ CPM API endpoints accessible
✅ File download/upload working
✅ Template creation working
```

---

## 🔧 **Troubleshooting**

### **If CPM APIs Still Fail:**
1. **Check Username/Password**: Ensure admin credentials are correct
2. **Verify Admin Access**: User must have access to customization pages
3. **Test Manual Login**: Try logging into PowerSchool web interface

### **If OAuth APIs Fail:**
1. **Check Plugin Installation**: Ensure PowerSchool plugin is installed/enabled
2. **Verify Credentials**: Check Client ID and Secret are correct
3. **Test Standard APIs**: Run connection test to diagnose OAuth issues

---

## 💡 **Why This Works**

PowerSchool has different API tiers:
- **Public APIs**: Support OAuth authentication
- **Internal APIs**: Require session-based authentication
- **CPM APIs**: Fall into the "internal" category

The hybrid approach respects these architectural decisions while providing the best user experience.

---

## 🎉 **Ready to Test!**

**Current Status**: Extension v1.1.0 installed with hybrid authentication support

**Next Step**: Configure your settings with both OAuth and session credentials, then test the connection!