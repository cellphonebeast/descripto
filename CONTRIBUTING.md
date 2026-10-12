# Contributing to Descripto

Thanks for helping improve Descripto. It is a local, single-user editor built with Next.js, React, TypeScript, Electron, and FFmpeg.

## Local setup

Follow the [README](README.md#quick-start). Use your own provider keys in Settings or an ignored `.env.local`. Manual editing and the tests do not require paid API calls.

Before a pull request:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

FFmpeg must be installed for media tests. For UI changes, verify the editor with a disposable synthetic or permission-cleared recording. Check cut/restore, Undo/Redo, both scrubbers, empty edits, and export cancellation when relevant.

## Pull requests

- Describe the problem, behavior after the change, and how you tested it.
- Keep changes focused and preserve existing saved projects.
- Add regression tests for bugs involving edit timing, data loss, cancellation, or provider behavior.
- Never include recordings, transcripts, `.env` files, saved connections, logs containing private content, or generated app bundles.
- Use fake keys and mocked providers in automated tests. Do not require a contributor's live account to run CI.
- If you change dependencies, commit the updated pnpm lockfile.

## Bug reports

Include your OS, Node version, install method, exact steps, and a sanitized error message. State whether the issue occurs in the desktop window or browser. Prefer a short synthetic reproduction to sharing real recordings. Never post API keys or a `connections.json` file.

For vulnerabilities or accidental credential exposure, use the private reporting guidance in [SECURITY.md](SECURITY.md).

Contributions are made under the repository's MIT license.
