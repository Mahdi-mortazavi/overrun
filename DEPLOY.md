# Deploying OVERRUN

Everything in this repository builds and ships from CI. This file is the
complete list of the things a human still has to do by hand — once — and the
order to do them in.

---

> **The signing password is deliberately not in this file.** It lives in
> `SECRETS.local.md`, which is gitignored, and it is also printed once in the
> session that generated it. A release-signing password committed to a public
> repository is a permanent compromise: anyone who has it plus the keystore can
> publish an update to `dev.overrun.game`. Copy it into GitHub Secrets, store it
> in a password manager, and delete the local copy.

## خلاصه‌ی فارسی — کارهایی که فقط خودت می‌توانی انجام بدهی

بقیه‌ی این فایل انگلیسی است و همه‌ی جزئیات را دارد. این بخش فقط فهرست کارهای
دستی است، به همان ترتیبی که باید انجام شوند:

1. **مخزن گیت‌هاب بساز** و کد را push کن (بخش ۱).
2. **کلیدهای امضای اندروید را در GitHub Secrets بگذار.** فایل
   `KEYSTORE_BASE64.txt` در ریشه‌ی پروژه ساخته شده؛ محتوایش را در سکرتی به نام
   `ANDROID_KEYSTORE_BASE64` بگذار. رمز عبور و نام alias در جدول بخش ۲ آمده‌اند.
   ⚠️ فایل `release.keystore` و رمزش را **جای امنی نگه دار** (مثلاً یک
   password manager). اگر گم شوند، دیگر هرگز نمی‌توانی برای همین اپلیکیشن
   به‌روزرسانی منتشر کنی و کاربران باید اپ را پاک و دوباره نصب کنند.
3. **حساب Cloudflare**: یک API Token بساز و آن را به‌همراه Account ID در
   GitHub Secrets بگذار (`CLOUDFLARE_API_TOKEN` و `CLOUDFLARE_ACCOUNT_ID`).
4. **زیردامنه‌ی workers.dev را فعال کن** و بعد از اولین دیپلوی، آدرس واقعی
   (چیزی شبیه `overrun.NAME.workers.dev`) را در متغیّر مخزن `OVERRUN_HOST`
   بگذار — تا بازیِ داخل APK بداند سرور آنلاین کجاست (بخش ۵).
5. **سه سکرت سمت Cloudflare** را با دستور `wrangler secret put` ست کن:
   `INTERNAL_SECRET`، `MATCH_SECRET`، `SUPABASE_SERVICE_KEY` (بخش ۴).
6. **در پنل Supabase**: اسکیمای `game` را در فهرست Exposed schemas اضافه کن،
   ورود ناشناس (Anonymous sign-ins) را روشن کن، و `MATCH_SECRET` را برای
   Edge Function ست کن — همان مقداری که به Cloudflare دادی (بخش ۶).
7. **کلید anon سوپابیس** را در `packages/server/wrangler.toml` جای‌گزین
   `set-me-or-the-leaderboard-returns-an-empty-array` کن و commit کن.

بعد از این هفت کار، هر push روی شاخه‌ی `main` خودش بازی را دیپلوی می‌کند و
یک APK امضاشده می‌سازد. برای انتشار نسخه، فقط یک تگ مثل `v1.0.0` بزن.

---

## What ships where

| Piece | Built by | Lives on |
| --- | --- | --- |
| The game (PWA) | `npm run build` → `packages/client/dist` | Cloudflare Workers static assets |
| The multiplayer server | `packages/server` | Cloudflare Worker + two Durable Objects |
| Accounts, leaderboards | `packages/server/supabase` | Supabase (Postgres + Edge Function) |
| The Android app | Capacitor, `packages/android` | GitHub Releases (sideload) / Play (later) |

Two workflows do the work:

* `.github/workflows/deploy.yml` — on every push to `main`: runs the headless
  simulation as a gate, builds the client, `wrangler deploy`.
* `.github/workflows/android.yml` — on every push to `main` and every `v*` tag:
  builds and signs the APK and the AAB, verifies both, uploads them as
  artifacts, and attaches them to a GitHub Release when the trigger is a tag.

---

## 1. Create the repository and push

```bash
cd /path/to/overrun
git init                      # if it is not a repo yet
git add -A
git commit -m "OVERRUN"

gh repo create overrun --private --source=. --remote=origin --push
# or, without the gh CLI: create the repo on github.com, then
#   git remote add origin git@github.com:<you>/overrun.git
#   git branch -M main
#   git push -u origin main
```

Before the first push, confirm the signing material is not in the commit:

```bash
git check-ignore -v release.keystore KEYSTORE_BASE64.txt
# both must print a matching .gitignore rule
git ls-files | grep -Ei 'keystore|\.jks|\.p12'   # must print nothing
```

The first push to `main` will start both workflows. `deploy` will fail until
the Cloudflare secrets exist and `android` will fail until the keystore secrets
exist — that is expected, and both are fixed in the next two sections.

---

## 2. GitHub Secrets

`Settings → Secrets and variables → Actions → New repository secret`.

### Android signing — the values generated for this project

The keystore has already been created and is sitting at `release.keystore` in
the repository root (gitignored). Its base64 form is in `KEYSTORE_BASE64.txt`.

> **These are the values to paste into GitHub Secrets, and then to store in a
> password manager and delete from any chat log.** The keystore is not
> replaceable: Android identifies an app by the certificate that signed it, so
> losing this file means never being able to update `dev.overrun.game` again.
> Keep an offline copy of `release.keystore` too, not only the base64 text.

| Secret name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the entire contents of `KEYSTORE_BASE64.txt` (one long line, no newline at the end) |
| `ANDROID_KEYSTORE_PASSWORD` | see `SECRETS.local.md` (gitignored, delivered to you separately) |
| `ANDROID_KEY_ALIAS` | `overrun` |
| `ANDROID_KEY_PASSWORD` | same value as `ANDROID_KEYSTORE_PASSWORD` — the store is PKCS#12, where the key and store passwords must match |

Keystore facts, for the record:

```
file        release.keystore          (PKCS#12, 2730 bytes)
alias       overrun
algorithm   RSA 2048, SHA384withRSA
validity    10000 days (expires 2053-12-16)
subject     CN=OVERRUN, OU=OVERRUN, O=OVERRUN, L=Tehran, ST=Tehran, C=IR
SHA-256     DD:98:B5:7F:51:67:13:80:62:35:4C:47:D7:31:BD:FD:A1:ED:D8:80:CE:59:4E:17:E2:26:CC:11:33:B1:F0:EB
SHA-1       3D:62:C4:65:FA:05:B1:4B:F4:0E:B6:1E:74:C4:7A:A1:8A:65:49:44
```

Copy the base64 into your clipboard with:

```bash
# Linux
xclip -sel clip < KEYSTORE_BASE64.txt
# macOS
pbcopy < KEYSTORE_BASE64.txt
# Windows (PowerShell)
Get-Content KEYSTORE_BASE64.txt | Set-Clipboard
```

To regenerate a keystore from scratch later (only if you are starting a new
app identity — it will not update the existing one):

```bash
keytool -genkeypair -v -keystore release.keystore -storetype PKCS12 \
  -alias overrun -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=OVERRUN, O=OVERRUN, C=IR"
base64 -w0 release.keystore > KEYSTORE_BASE64.txt
```

### Cloudflare

| Secret name | What it is | How to get it |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Lets CI run `wrangler deploy` | dash.cloudflare.com → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template**. Leave the account scoped to your account and all zones. Create, then copy the token — it is shown once. |
| `CLOUDFLARE_ACCOUNT_ID` | Which account to deploy into | dash.cloudflare.com → Workers & Pages → the right-hand sidebar shows **Account ID**. Or run `npx wrangler whoami`. |

If you build the token by hand instead of using the template, it needs:

* Account → **Workers Scripts: Edit** (deploy the Worker and its assets)
* Account → **Account Settings: Read** (resolve the account)
* Account → **Workers KV Storage: Edit** (wrangler's own bookkeeping)
* User → **Memberships: Read**

Durable Objects need no separate permission; they are part of Workers Scripts.

### Repository *variable* (not a secret)

| Variable | Value | Why |
| --- | --- | --- |
| `OVERRUN_HOST` | e.g. `overrun.yourname.workers.dev` | The Android build bakes this in as the app's origin so online play reaches the deployed Worker. Set it after step 5, then re-run the `android` workflow. |

Set it under `Settings → Secrets and variables → Actions → Variables`.

---

## 3. Cloudflare: first deploy

You can let CI do it, but doing the first one locally gives much better error
messages.

```bash
cd packages/server
npx wrangler login              # opens a browser
npx wrangler deploy
```

**Enable your workers.dev subdomain.** The first time you deploy, Cloudflare
asks you to pick a subdomain (Workers & Pages → your account → *Subdomain*).
Pick something short; the game will live at
`https://overrun.<your-subdomain>.workers.dev`. Invite links look like
`https://overrun.<your-subdomain>.workers.dev/j/ABC123`.

**Durable Objects on the free plan.** The free plan allows Durable Objects
only when the classes are **SQLite-backed**. `packages/server/wrangler.toml`
already declares them correctly:

```toml
[[migrations]]
tag = "v1"
new_sqlite_classes = ["MatchRoom", "Matchmaker"]
```

If you ever see `Durable Objects with a key-value storage backend are only
available on the paid plan`, someone changed `new_sqlite_classes` to
`new_classes`. Change it back. Never rename these classes without adding a new
`[[migrations]]` entry with `renamed_classes` — a bare rename destroys the
state of every live room.

---

## 4. Cloudflare: the three Worker secrets

These are *Cloudflare* secrets, not GitHub secrets. They are set once, per
Worker, and CI never sees them.

```bash
cd packages/server

# 1. Shared secret between MatchRoom and /api/match-result. Until this exists,
#    /api/match-result answers 503 and refuses to record anything.
openssl rand -hex 32 | npx wrangler secret put INTERNAL_SECRET

# 2. Must be byte-identical to the MATCH_SECRET set on the Supabase Edge
#    Function (section 6). Generate it once and paste it in both places.
openssl rand -hex 32 | tee /tmp/match_secret | npx wrangler secret put MATCH_SECRET
cat /tmp/match_secret     # copy this for Supabase, then delete the file

# 3. Optional but recommended: the Supabase service_role key, used only as the
#    bearer token when calling the Edge Function.
npx wrangler secret put SUPABASE_SERVICE_KEY
```

Verify with `npx wrangler secret list`.

One value is *not* a secret and lives in `wrangler.toml` under `[vars]`: the
Supabase anon key. Replace the placeholder before your first real deploy:

```toml
SUPABASE_ANON_KEY = "eyJhbGciOi..."   # Supabase → Settings → API → anon public
```

It is publishable by design — row level security is what protects the data.

---

## 5. Point the Android app at the deployed server

The APK loads the game from its own assets and never from the network, which
is why it works with the radio off. Online play still has to know where the
server is, and it learns that from one hostname.

1. Deploy at least once so you know the real host, e.g.
   `overrun.yourname.workers.dev`.
2. Either set the repository variable `OVERRUN_HOST` (CI applies it
   automatically), or edit `packages/android/capacitor.config.json`:

```json
"server": {
  "androidScheme": "https",
  "hostname": "overrun.yourname.workers.dev",
  "allowNavigation": ["overrun.yourname.workers.dev"]
}
```

3. Re-run the `android` workflow (Actions → android → Run workflow).

If you skip this, the APK still installs and the whole single-player game
works; only matchmaking will fail and quietly drop you into an offline match.

If you later move to a custom domain, change this hostname to the custom
domain and rebuild. Note that changing it resets the app's local storage (a
different origin means different `localStorage`), so players lose local
progress — do it before you have players, not after.

---

## 6. Supabase

Project: the one whose URL is in `packages/server/wrangler.toml`
(`SUPABASE_URL`). Three things must be configured by hand in the dashboard.

### 6.1 Expose the `game` schema

The migrations put everything in a `game` schema; PostgREST only serves
schemas it has been told about.

**Settings → API → Data API → Exposed schemas** → add `game` (keep `public`
too) → Save. Then **Settings → API → Restart API** if the option is offered.

Without this, `/api/leaderboard` returns an empty array and nothing else
breaks — which is exactly why it is easy to miss.

### 6.2 Enable anonymous sign-ins

Players start playing before they make an account.

**Authentication → Providers → Anonymous sign-ins → Enable** → Save.

While you are there, **Authentication → Rate limits** is worth a look: the
default anonymous sign-in limit is 30/hour per IP, which is low if a lot of
players share a NAT.

### 6.3 Apply the migrations and deploy the Edge Function

```bash
cd packages/server
npx supabase link --project-ref <your-project-ref>
npx supabase db push                      # runs supabase/migrations/*.sql in order
npx supabase functions deploy submit-match
```

### 6.4 Set `MATCH_SECRET` for the Edge Function

Use the **same value** you gave the Worker in section 4.

```bash
npx supabase secrets set MATCH_SECRET="<the value from /tmp/match_secret>"
```

Or in the dashboard: **Edge Functions → Manage secrets → Add new secret**.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into Edge
Functions automatically; you do not set those.

---

## 7. Cutting a release

```bash
git tag v1.0.0
git push origin v1.0.0
```

The `android` workflow builds, signs and verifies the APK and AAB, then
creates a GitHub Release with both attached. The APK is the file people
sideload; the AAB is only useful if you later publish on Google Play.

Pushes to `main` build the same artifacts but leave them as workflow artifacts
(90 day retention) rather than making a release.

---

## 8. Installing the game

### As a PWA (no app store, works everywhere)

**Android / Chrome** — open the site, tap the ⋮ menu → *Add to Home screen* →
*Install*. Chrome may show an install banner on its own. The installed app
launches fullscreen and landscape, and works offline afterwards.

**iOS / iPadOS — Safari only** — open the site in Safari, tap the Share button
→ *Add to Home Screen* → *Add*. (Chrome on iOS cannot install PWAs; the button
lives only in Safari.) iOS ignores the manifest's `orientation`, so the game
locks itself in software — leave the device's rotation lock off for the best
result.

**Windows — Edge or Chrome** — open the site, click the install icon at the
right end of the address bar (a monitor with a downward arrow), or menu →
*Apps → Install this site as an app*.

**macOS — Chrome or Edge** — same install icon in the address bar. On Safari
17+ use *File → Add to Dock*.

Once installed, everything is cached locally: the game starts and plays with
the network completely off. Only matchmaking, joining a room and the
leaderboard need connectivity.

### The Android APK (sideload)

1. On the phone, open the Release page and download `overrun-<version>.apk`.
2. Tap the downloaded file. Android will say the source is not allowed.
3. Tap **Settings** in that dialog and turn on **Allow from this source** for
   the app doing the installing (usually Chrome or Files).
4. Go back, tap the APK again, **Install**.
5. If Play Protect warns that it does not recognise the developer, choose
   **Install anyway** — the APK is signed with your own key rather than one
   Google has seen before, which is exactly what "unknown developer" means here.

Requirements: Android 8.0 (API 26) or newer, and a WebView with WebGL, which
every device from that era has.

To install from a computer with the platform tools:

```bash
adb install -r overrun-1.0.0.apk
```

---

## 9. Building the Android app locally

You need JDK 21 and the Android SDK (Android Studio installs both).

```bash
npm ci
npm run build                     # produces packages/client/dist

cd packages/android
npm run sync                      # cap sync + inject the native online shim
npm run icons                     # only if the source artwork changed

cd android
./gradlew assembleDebug           # unsigned, installable for testing
```

For a signed local release build, export the same four variables CI uses:

```bash
export ANDROID_KEYSTORE_PATH="$PWD/../../../release.keystore"
export ANDROID_KEYSTORE_PASSWORD='<from SECRETS.local.md>'
export ANDROID_KEY_ALIAS='overrun'
export ANDROID_KEY_PASSWORD='<from SECRETS.local.md>'
./gradlew assembleRelease
# app/build/outputs/apk/release/app-release.apk
```

`packages/android/android/` is generated by Capacitor but is checked in,
because it carries hand-written configuration: the manifest, the immersive
fullscreen and back-button handling in `MainActivity.java`, the adaptive icon
and the splash theme. Do not delete and re-add the platform; that would throw
all of it away.

---

## 10. Troubleshooting

**The APK installs but shows a white screen.**
The web assets did not get in. Run `npm run build` at the root, then
`npm run sync` in `packages/android`, and check that
`packages/android/android/app/src/main/assets/public/index.html` exists. The
Gradle build has a `verifyWebAssets` task and CI has a size check that should
both catch this before it reaches a device.

**CI fails at "Verify the artifacts" with "effectively unsigned".**
One of the four `ANDROID_*` secrets is missing, empty, or has a stray newline.
Re-paste `ANDROID_KEYSTORE_BASE64` as a single line. `base64 -w0` (Linux) or
`base64 -i file` (macOS) avoids wrapped output.

**CI fails with `Failed to install the following Android SDK packages`.**
Google moved a build-tools version. Update the version in
`.github/workflows/android.yml` (the `sdkmanager --install` line) to the newest
`build-tools;3x.y.z`.

**Gradle fails with a compileSdk complaint.**
`packages/android/android/variables.gradle` targets SDK 36 with the AGP that
Capacitor 7 pins. If a future AGP turns that combination into a hard error, set
`compileSdkVersion` and `targetSdkVersion` to `35` there and rebuild.

**`wrangler deploy` fails with "Durable Objects ... paid plan".**
See section 3: the classes must be declared in `new_sqlite_classes`.

**`wrangler deploy` fails with 10000 "Authentication error".**
The API token is wrong or lacks *Workers Scripts: Edit*. Recreate it from the
"Edit Cloudflare Workers" template.

**Online play does nothing in the APK, but works in the browser.**
`server.hostname` in `packages/android/capacitor.config.json` (or the
`OVERRUN_HOST` variable) is not the deployed host. See section 5. You can
confirm what the app thinks by connecting `chrome://inspect` from a desktop
Chrome to the device and reading `window.OVERRUN_NATIVE`.

**The leaderboard is always empty.**
The `game` schema is not in Supabase's exposed schemas (6.1), or
`SUPABASE_ANON_KEY` in `wrangler.toml` is still the placeholder.

**Match results never appear.**
`INTERNAL_SECRET` is unset (the Worker answers 503 by design), or the Worker's
`MATCH_SECRET` and the Edge Function's `MATCH_SECRET` are not identical.

**The simulation gate fails and blocks the deploy.**
That is the gate doing its job: `node tools/simtest.mjs` threw. Run it locally
— it prints per-mode telemetry and the stack of whatever broke. Nothing
deploys until it passes.

**A player's progress vanished after an update.**
The origin changed (section 5). Progress lives in `localStorage`, which is
keyed by origin. Avoid changing `server.hostname` once the app is out.
