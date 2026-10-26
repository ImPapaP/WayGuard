# Working on Wayguard together

The live site (Render) redeploys automatically from the `main` branch, so a
mistake pushed to `main` goes straight to users. Work on a branch and merge
through a pull request once the automatic check passes.

## Everyday flow

1. Get the latest code: in GitHub Desktop, **Fetch origin** then **Pull**
   (or `git pull` on `main`).
2. **Branch → New branch**, name it after the change, e.g.
   `fix-signup-picker` or `feature/heat-map`.
3. Make the change, run `npm test` (and `npm run test:e2e` for screen changes).
4. **Commit**, then **Publish branch**, then **Create Pull Request**.
5. On GitHub, wait for the **Verify WayGuard** check to turn green. Ask a
   teammate to look at it if you can.
6. **Merge pull request**. Render deploys `main` a few minutes later.
7. Delete the branch (GitHub offers a button after merging).

If two people changed the same lines, GitHub shows a conflict on the pull
request; GitHub Desktop can open the files so you can keep the right parts.

## Protect `main` (once, by the repository owner)

GitHub → the **WayGuard** repository → **Settings** → **Branches** →
**Add branch ruleset** (or **Add rule**):

- Branch name pattern / target: `main`
- Tick **Require a pull request before merging**
  (approvals: 0 for a small team, 1 if you want a second pair of eyes)
- Tick **Require status checks to pass** and add **verify**
  (the job from `.github/workflows/verify.yml`; it appears in the list after
  it has run once)
- Tick **Block force pushes**
- Save.

After this, nobody (including tools acting for you) can push straight to
`main`; changes arrive only through pull requests that pass the check.

## Tests

- `npm test` — API tests (needs the `wayguard_test` database; see README)
- `npm run test:e2e` — full browser walk-through
- `npm run test:e2e:map` — map screen, night/day and drive mode
