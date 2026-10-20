// PDF Reader — configuration. This file contains NO secrets.
// An OAuth "Web application" client ID is public by design; it only works
// from the Authorized JavaScript origins you list in Google Cloud Console.
export const CONFIG = {
  // 1) Paste your OAuth 2.0 Web client ID here (see SETUP.md).
  CLIENT_ID: 'PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com',

  // Private Drive folder + manifest created for Fred (owner: greengotme007@gmail.com).
  FOLDER_ID: '1ae510x7HVf-bslM66RFLmJCiB39J921K',
  // Leave blank (recommended): the app finds the newest 'library.json' inside FOLDER_ID, so the
  // manifest can be replaced (new file id) without touching the app. Current id, for reference:
  // 10ASiZbhLUjWouq_gt_FL69h--kJ1rAao
  MANIFEST_ID: '',

  // Read-only access. The app never writes to Drive.
  SCOPE: 'https://www.googleapis.com/auth/drive.readonly',

  // Pre-selects the right Google account in the sign-in prompt (optional).
  LOGIN_HINT: 'greengotme007@gmail.com',

  // 'auto'     = Google Identity Services popup in a browser tab, full-page redirect
  //              when launched from the iOS Home Screen (popups are flaky there).
  // 'gis'      = always use the GIS token-client popup.
  // 'redirect' = always use the full-page OAuth redirect.
  AUTH_MODE: 'auto',

  // Must exactly match an "Authorized redirect URI" in the OAuth client when the
  // redirect flow is used. Blank = current page URL without query/hash.
  REDIRECT_URI: '',
};
