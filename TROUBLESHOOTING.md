# PowerSchool CPM Plugin - Troubleshooting Guide

## Installation Error Resolution

The error you encountered indicates that PowerSchool has specific restrictions on permission mappings:

### **Error Analysis:**
- **"Plugins can only permission map named queries, not /ws/cpm/tree"**
- This means CPM API endpoints cannot be mapped through standard permission mappings
- CPM APIs might be "internal-only" or require special authorization

## Solution Approaches

### **Approach 1: Minimal OAuth Plugin (Current)**

I've created a clean plugin that only declares OAuth without problematic mappings:

**File: `ps-vscode-cpm-plugin-clean.zip`**
- Contains only `plugin.xml` with basic OAuth declaration
- No permission mappings that cause validation errors
- No v1 API access requests

**Installation:**
1. Try installing `ps-vscode-cpm-plugin-clean.zip`
2. Should install without validation errors
3. Test if basic OAuth works with CPM endpoints

### **Approach 2: Check CPM API Availability**

CPM endpoints might be:
- **Internal-only**: Only accessible within PowerSchool web interface
- **Legacy endpoints**: Not designed for external OAuth access
- **Undocumented**: Require special configuration

**Testing Steps:**
1. Install the minimal plugin
2. Get OAuth credentials
3. Test with "PowerSchool CPM: Test OAuth Connection"
4. Try accessing `/ws/v1/time` (should work)
5. Try accessing `/ws/cpm/tree` (might still fail)

### **Approach 3: Alternative API Endpoints**

If CPM endpoints don't work, we might need to:
- Use different PowerSchool APIs for file management
- Look for documented file/content management endpoints
- Contact PowerSchool support about CPM API access

## Next Steps

### **1. Install Clean Plugin**
```
File: ps-vscode-cpm-plugin-clean.zip
Location: PowerSchool Admin > Plugin Management Dashboard
```

### **2. Test Basic OAuth**
- Configure extension with OAuth credentials
- Run connection test
- Check if basic API access works

### **3. Test CPM Endpoints**
- Try to access the CPM tree view in extension
- Check console for specific error messages
- Document exact error responses

### **4. If CPM APIs Still Don't Work**
This would indicate that CPM APIs are not designed for external OAuth access. Possible solutions:

#### **Option A: Session-Based Authentication**
- Modify extension to use web login instead of OAuth
- Handle session cookies and CSRF tokens
- Less secure but might be required

#### **Option B: Different API Approach**
- Research alternative PowerSchool APIs for file management
- Use documented endpoints instead of CPM-specific ones
- Might have different functionality

#### **Option C: Contact PowerSchool**
- Ask PowerSchool support about CPM API access
- Request documentation for external CPM access
- Verify if OAuth is supported for CPM endpoints

## Current Status

**Clean Plugin Created**: `ps-vscode-cpm-plugin-clean.zip`
- Minimal OAuth declaration
- No validation errors
- Ready for testing

**Next**: Install clean plugin and test basic OAuth connectivity.