// EPUB Reader — configuration. This file contains NO secrets.
// Same OAuth "Web application" client as the PDF Reader: the app lives on the same origin
// (https://airobofred.github.io), so the existing Authorized JavaScript origin already covers it.
export const CONFIG = {
  CLIENT_ID: '529853828131-558446aci48kc8r17m5fii7qtfhkjbmp.apps.googleusercontent.com',

  // Private Drive folder "EPUB Reader Library" (owner: greengotme007@gmail.com, shared with nobody).
  FOLDER_ID: '1KJNdHYCIrMNNdJavORBLXMJIJCHz000a',
  // Leave blank (recommended): the app reads the newest 'library.json' inside FOLDER_ID, so the
  // manifest can be replaced (new file id) without touching the app.
  MANIFEST_ID: '',

  // Read-only access. The app never writes to Drive.
  SCOPE: 'https://www.googleapis.com/auth/drive.readonly',

  // Pre-selects the right Google account in the sign-in prompt (optional).
  LOGIN_HINT: 'greengotme007@gmail.com',

  // 'auto' = GIS popup in a browser tab, full-page redirect when launched from the iOS Home Screen.
  AUTH_MODE: 'auto',

  // Blank = current page URL without query/hash, i.e. https://airobofred.github.io/pdf-reader/epub/
  // That exact URL must be listed under "Authorized redirect URIs" for the Home Screen (redirect) sign-in.
  REDIRECT_URI: '',
};
