# PDF Reader: setup (about 15 minutes, one time)

The app is a static site: HTML, JS and CSS with no server code and no secrets. It talks
straight from your phone to **your** Google Drive with a read-only token. Before it can work,
it needs two things:

1. **An HTTPS address** to load it from (iOS needs HTTPS for Home Screen apps, and Google
   sign-in requires it).
2. **A Google OAuth "Web application" client ID.** This ID is public by design. It only works
   from the web addresses you allow.

Already done for you:
- Private Drive folder **PDF Reader Library**: `1ae510x7HVf-bslM66RFLmJCiB39J921K`
  (owner greengotme007@gmail.com, shared with nobody)
- Manifest **library.json** in that folder: `10ASiZbhLUjWouq_gt_FL69h--kJ1rAao`
- `config.js` already holds the folder ID. You only need to paste the client ID.

---

## Step 1: Choose the address (hosting)

**Recommended: a subdomain on your Hostinger account**, for example `https://reader.yourdomain.com`.
- You already pay for it. Hostinger's free SSL gives you HTTPS. The source stays private.
- In hPanel: **Websites → (your site) → Domains → Subdomains**, then create `reader`.
  Next, go to **Security → SSL** and make sure the subdomain has SSL (it is usually automatic).
- Upload the contents of `pdf-reader-deploy.zip` into the subdomain's folder
  (for example `public_html/reader/`) with **File Manager → Upload**, then **Extract**.
  `index.html` must sit at the top of that folder. The included `.htaccess` sets the right
  JavaScript MIME types.

**Free alternative: GitHub Pages.** Make a repo, push these files, and turn on
**Settings → Pages → Deploy from branch (main, / root)**. Your address becomes
`https://<username>.github.io/<repo>/`. Free Pages sites need a **public** repo. That is
safe because the app holds no secrets (a folder ID gives nobody access to a private folder),
but the code itself would be public.

Write down your final address (the **APP URL**) exactly. You need it twice below. Examples:
- `https://reader.yourdomain.com/`
- `https://fred.github.io/pdf-reader/`

The **ORIGIN** is the APP URL without any path and without a trailing slash, for example
`https://reader.yourdomain.com` or `https://fred.github.io`.

## Step 2: Create the Google OAuth client

Sign in to <https://console.cloud.google.com> as **greengotme007@gmail.com** (the account
that owns the Drive folder).

1. **Create a project.** Use the project picker at the top, choose **New project**, name it
   `PDF Reader`, and click **Create**. Then select it.
2. **Enable the Drive API.** Go to **APIs & Services → Library**, search for
   **Google Drive API**, and click **Enable**.
3. **Set up the consent screen.** Open **Google Auth Platform**, also listed as
   **APIs & Services → OAuth consent screen**, and click **Get started**.
   - App name: `PDF Reader`. User support email: your address.
   - Audience: **External**.
   - Contact email: your address. Agree to the policy and click **Create**.
4. **Add yourself as a test user.** Go to **Audience → Test users → Add users**, enter
   `greengotme007@gmail.com`, and save. Leave Publishing status set to **Testing**.
   Do not publish. Testing mode is right for a personal app and needs no Google review.
5. *(Optional, tidy)* Go to **Data Access → Add or remove scopes**, tick
   `.../auth/drive.readonly` ("See and download all your Google Drive files"), and save.
6. **Create the client.** Go to **Clients → Create client**:
   - Application type: **Web application**. Name: `PDF Reader web`.
   - **Authorized JavaScript origins → Add URI:** your **ORIGIN**
     (for example `https://reader.yourdomain.com`).
   - **Authorized redirect URIs → Add URI:** your **APP URL**, exactly, including the
     trailing slash (for example `https://reader.yourdomain.com/`). The Home Screen app
     signs in with a full-page redirect, and that flow needs this entry.
   - *(Optional, for local testing)* add the origin `http://localhost:8765` and the
     redirect URI `http://localhost:8765/`.
   - Click **Create** and copy the **Client ID**. It ends in `.apps.googleusercontent.com`.
     You do **not** need the client secret. Never put it in the app.

## Step 3: Paste the client ID

Edit `config.js`:

```js
CLIENT_ID: '1234567890-abc123.apps.googleusercontent.com',
```

Upload `config.js` again. Changes can take a few minutes to show up because Google sometimes
needs about 5 minutes to recognize a new origin.

If you open the app from a URL other than the APP URL (for example `/index.html`), set
`REDIRECT_URI` in `config.js` to the exact redirect URI you registered.

## Step 4: Install it on your iPhone

1. Open the APP URL in **Safari**.
2. Tap **Sign in with Google** and choose greengotme007@gmail.com.
   - You will see **"Google hasn't verified this app"**. This is expected for your own
     Testing-mode app. Tap **Continue**, then allow **See and download your Google Drive files**.
3. Tap **Share → Add to Home Screen → Add**.
4. Open **PDF Reader** from the Home Screen and sign in once more. The Home Screen app keeps
   its own storage, separate from Safari.

**Better voices (recommended):** go to iPhone **Settings → Accessibility → Spoken Content →
Voices → English → (pick a voice) → download the "Enhanced" or "Premium" version**. Zoe,
Ava and Evan are good choices. The app picks en-US Premium or Enhanced voices first, and you
can change the voice in ⚙︎.

## Step 5: Add and tag PDFs

- **Add:** drop PDFs into the **PDF Reader Library** folder in Google Drive, from any device.
  Tap ⟳ in the app and they show up under **Untagged**.
- **Tag:** tags live in `library.json`, which is the single source of truth:
  ```json
  {
    "version": 1,
    "tags": ["Business plans", "Industry reports"],
    "items": [
      { "fileId": "<Drive file id>", "name": "Acme Plan", "tags": ["Business plans"], "added": "2026-10-16", "pages": 24 }
    ]
  }
  ```
  The easiest way is to ask Grok Bot, for example: *"tag the new PDFs in my PDF Reader
  Library."* It finds the new files and writes a new `library.json`. The app always reads
  the newest `library.json` in the folder, so the manifest ID can change without breaking
  anything. You can also edit the file yourself in any text editor and upload it to replace
  the old one.
- A tag listed in `tags` that has no documents still appears as a filter chip. New tags that
  only appear on items are picked up automatically.

---

## What to expect / known limits

- **The screen lock stops speech on iPhone.** Safari's speech engine (`speechSynthesis`) is
  not a media player. When the phone locks or you switch apps, iOS suspends it, and the
  lock-screen controls don't appear. To work around this:
  - **Keep screen on while reading** (⚙︎, on by default) uses the Screen Wake Lock API so the
    phone doesn't auto-lock while it's reading. This needs iOS 16.4+ in Safari and iOS 18.4+
    for Home Screen apps. Pressing the side button still locks the phone.
  - When you come back, the app tries to continue automatically. If iOS blocks that, tap ▶.
    Your place is saved after every sentence.
  - True background or locked-screen listening would need audio files, from a cloud TTS
    service rendering MP3s. That is a possible upgrade, and it would mean sending text to
    that service.
- **iOS needs a tap to start speech.** The first ▶ (or a tap on a sentence) starts it.
  Playback continues on its own after that.
- **Pause / resume:** pausing stops at the current sentence, and resuming restarts that
  sentence. This is more reliable on iOS than the native pause.
- **Long text is chunked** into sentences of at most 220 characters, so iOS and Chrome don't
  cut off long utterances.
- **Scanned PDFs** (images with no selectable text) can't be read. OCR isn't included.
- **Sign-in lasts about an hour** (Google access tokens). Text you have already opened is
  cached on the device, so reading continues. To refresh the library after that, tap
  **Sign in** again. Usually it's one tap with no prompts. In Testing mode, Google may ask
  for consent again about once a week.
- **Privacy:** read-only Drive scope. The app requests only the library folder's file list,
  `library.json`, and the PDFs you open. Extracted text and reading positions stay on the
  device (IndexedDB/localStorage). Use **⚙︎ → Clear cached text** or **Sign out** to remove them.
- `drive.file` (the narrower scope) won't work here. It only covers files the app created or
  you picked in a Google Picker, so it can't see PDFs you drop into the folder from Drive.
  That's why the app uses `drive.readonly`.

## Try it without Google (demo)

Open `<APP URL>?demo=1`. It uses three bundled sample PDFs. Add `&mockspeech=1` to simulate
speech on a computer with no voices installed.

Local test: `cd pdf-reader && python3 -m http.server 8765`, then open
`http://localhost:8765/?demo=1`.
