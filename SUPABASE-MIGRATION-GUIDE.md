# Migrating Character Portraits & Records to Supabase

This covers the part of your data layer the requirements asked for: the
`characters` table (name, class, story, portrait URL) and the `avatars`
storage bucket. `app.js` and `index.html` are already updated — the steps
below are the Supabase-side setup those code changes depend on.

## 1. Create the `characters` table

In your Supabase project: **SQL Editor → New query**, run:

```sql
create table if not exists public.characters (
  id text primary key,              -- matches the app's local uid(), so inserts/updates line up
  name text not null,
  class text,
  story text,
  portrait_url text,
  created_at timestamptz default now()
);

alter table public.characters enable row level security;

-- Personal-project policy: anyone with the anon key can read/write.
-- Fine for a solo campaign tracker with no login screen. Tighten this
-- (e.g. scope to auth.uid()) the moment you add user accounts.
create policy "public read" on public.characters
  for select using (true);
create policy "public write" on public.characters
  for insert with check (true);
create policy "public update" on public.characters
  for update using (true);
```

## 2. Create the `avatars` storage bucket

**Storage → New bucket** → name it `avatars` → toggle **Public bucket** on
(so `getPublicUrl()` returns a URL that loads without auth).

Then, in the SQL editor, allow uploads through the anon key:

```sql
create policy "public avatar read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "public avatar upload" on storage.objects
  for insert with check (bucket_id = 'avatars');
```

⚠️ **Important:** your anon/publishable key is meant to be embedded in
client-side code — that part's fine. But it only stays safe if RLS
policies like the ones above actually exist. Without them, `enable row
level security` with **no policies** blocks all access (safe but broken),
while a table with RLS **disabled** is wide open to anyone who has your
key. Don't skip step 1's `enable row level security` line.

## 3. What changed in the code

- **`index.html`**: added the Supabase v2 CDN script tag before `app.js`.
- **`app.js`**:
  - `sb` — the initialized Supabase client (top of file).
  - `uploadPortraitImage(file)` — uploads a raw `File` to the `avatars`
    bucket under a timestamped name, returns the public URL (or `null`
    on failure).
  - `insertCharacterRemote(character)` / `updateCharacterRemote(id, character)`
    — insert/update a row in `characters`.
  - `fetchAllCharactersRemote()` — loads every character row on startup.
  - The character modal's photo picker now uploads to Supabase Storage
    instead of converting to base64.
  - Saving a character now writes to Supabase first; if that fails, the
    modal stays open and nothing is lost locally.
  - `localStorage` is kept as a local cache (via the existing `saveData()`)
    so the app still works offline and the rest of the app — NPCs, quests,
    sessions, treasury, rules — is untouched.

## 4. Extending this to NPCs, quests, sessions, etc.

Not covered by this pass, since the requirements scoped this to
`characters`. Same pattern applies: create a table, add RLS policies,
add `insertXRemote` / `fetchAllXRemote` functions, swap the relevant
`readImageAsDataURL` calls for `uploadPortraitImage`. If you want the
*entire* character sheet (ability scores, personality fields, etc.) in
the cloud rather than just name/class/story/portrait, either add a
column per field or store the rest as a single `jsonb` column and merge
it back in `remoteRowToCharacter`.

## 5. Testing

1. Run the two SQL blocks above in your Supabase project.
2. Open the app, add a character with a photo.
3. Check **Table Editor → characters** — the row should appear.
4. Check **Storage → avatars** — the image should appear.
5. Reload the page — the character should still be there (now loaded
   from Supabase, not just localStorage).
6. Turn off your network mid-upload to confirm you get a toast instead
   of a frozen UI.
