# Pushing this to GitHub

The GitHub plugin in the session that built this could read your account but
was not granted permission to create repositories, so the last step is yours.
It takes about a minute.

```bash
# 1. Unzip somewhere sensible
unzip overrun.zip && cd overrun

# 2. Create the repo (either the web UI, or the gh CLI)
gh repo create Mahdi-mortazavi/overrun --public --source=. --remote=origin --push

# ...or, without the gh CLI: create an empty repo named `overrun` at
#    https://github.com/new  (no README, no .gitignore, no licence)
git remote add origin https://github.com/Mahdi-mortazavi/overrun.git
git branch -M main
git push -u origin main
```

The git history is already in the archive, so `git log` will show the work in
the order it was done rather than one flat commit.

## Immediately after pushing

Open `DEPLOY.md` and work through it. The short version:

1. Add the four Android signing secrets from `SECRETS.local.md` to
   **Settings → Secrets and variables → Actions**.
2. Add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
3. `cd packages/server && npx wrangler login && npx wrangler deploy`.
4. In the Supabase dashboard: expose the `game` schema and enable anonymous
   sign-ins. Nothing online works until those two toggles are on.
5. Tag `v1.0.0` and push the tag — CI builds and signs the APK and attaches it
   to a GitHub Release.

## Playing it right now, before any of that

```bash
cd packages/client
npm install
npm run build
npx vite preview --port 4173
# then open http://localhost:4173
```

Single player, both PvP modes against bots, and the whole UI work with no
server and no network at all. Only matchmaking and rooms need the Worker.
