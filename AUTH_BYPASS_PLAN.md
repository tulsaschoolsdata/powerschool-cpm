# AUTH_BYPASS_PLAN.md

## Goal
Enable the PowerSchool CPM VS Code extension to authenticate using a user-provided session cookie, bypassing the standard username/password login. This allows use in SSO/MFA environments where direct login is not possible.

---

## Detailed Implementation Plan

### 1. Extension Settings
- **Add a new setting**: `ps-vscode-cpm.sessionCookie`
  - Type: string
  - Description: "Paste a valid PowerSchool session cookie here to bypass normal login."
  - Scope: window
  - Add to the extension's configuration in `package.json`.

### 2. API Logic Changes
- **Modify `PowerSchoolAPI` class:**
  - On initialization, read `sessionCookie` from settings.
  - If `sessionCookie` is set and non-empty:
    - Use it as the value for the `Cookie` header in all API requests.
    - Skip all login/session-check logic (`getLoginPage`, `submitLogin`, `checkSession`, etc.).
    - Mark the session as always valid while the cookie is present.
  - If not set, use the existing username/password flow.
- **Update `getAuthHeaders()`**:
  - If `sessionCookie` is set, return `{ 'Cookie': sessionCookie }`.
  - Otherwise, build the cookie header from the internal cookie map as before.

### 3. Error Handling & User Feedback
- **Handle 401/403 errors**:
  - If a request fails with 401/403 and `sessionCookie` is in use, show a VS Code error: "Session cookie is invalid or expired. Please update the cookie in settings."
  - Optionally, provide a command to clear the session cookie and revert to normal auth.
- **Warn on startup** if both `sessionCookie` and username/password are set: "Session cookie will take precedence over username/password."

### 4. UI/UX Improvements
- **Add a command**: "Clear PowerSchool Session Cookie" to quickly remove the cookie from settings.
- **Add documentation**:
  - How to extract a valid session cookie from the browser (step-by-step, with screenshots if possible).
  - Security warning: "Never share or commit your session cookie."
  - Note that cookies expire and must be refreshed manually.

### 5. Testing
- Test with a valid session cookie in an SSO/MFA environment.
- Test fallback to username/password when the cookie is removed.
- Test error handling for expired/invalid cookies.

---

## Developer Implementation Notes (May 2026)

- The `ps-vscode-cpm.sessionCookie` setting is now supported in the extension.
- When this value is set:
  - Username/password are ignored, and the supplied cookie is always used on every API request.
  - The login/session validation logic is entirely bypassed!
  - A warning will appear if both auth methods are set, clarifying that the cookie is taking precedence.
- To test:
  1. Paste a valid session cookie (extracted from browser/devtools after SSO/MFA) into your `settings.json` or VS Code UI.
  2. All outgoing requests will use it immediately; if expired/invalid, requests will fail with 401/403 per usual.
- Code is robustly commented for future maintainers.
- Sensitive: Remind users never to commit the session cookie to source control.

---

## Risks & Limitations
- Session cookies expire; users must refresh them manually.
- No support for automating SSO/MFA login.
- Users must understand how to extract cookies securely.

---

## Deliverables
- Updated extension code (settings, API logic, error handling)
- Updated documentation (README, copilot-instructions)
- New command for clearing the session cookie
- Thorough manual test cases
