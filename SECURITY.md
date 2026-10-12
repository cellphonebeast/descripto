# Security

Descripto is intended for a trusted single user on a local computer. It is not a hosted service. The server has no multi-user authentication or tenant isolation. Keep it on loopback (`127.0.0.1`); do not expose it through a tunnel, public host, port forwarding, or shared network.

## Private data

Recordings, transcripts, renders, and project state belong in the ignored `projects/` directory. Provider credentials belong in Settings or ignored environment files, never in source control. Saved connection settings are permission-restricted where supported but are not encrypted at rest.

Cloud transcription, assistance, proofreading, review, and audio finishing send content to their selected providers. See the README's data-flow table before using sensitive recordings. Provider policies apply separately.

The assistant's explicit tool list limits its available application actions; it does not create an OS sandbox. Review edits and back up valuable work.

## Report a vulnerability

Use the repository's **Security → Report a vulnerability** option for a private report when available. Include a minimal reproduction and affected version without real keys or private media. If private reporting is unavailable, open a public issue requesting a private contact channel, without disclosing the exploit or secret.

If a key is exposed, revoke or rotate it with its provider immediately. Removing it from Git history alone does not invalidate it.

## Updates

Only the current main branch is maintained. Update dependencies and rebuild regularly. Report dependency advisories with the package name and advisory link, without including private environment details.
