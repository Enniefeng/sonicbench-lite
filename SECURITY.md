# Security and data handling

SonicBench Lite is a browser-only prototype. It provides workflow-level anonymization, not server-side access control.

## Do not commit

- Real model Mapping JSON files.
- Internal or signed audio URLs.
- Completed work orders or annotation exports containing business data.
- Access tokens, credentials, user identities, or private evaluation prompts and lyrics.

Generated filenames are covered by `.gitignore`, but repository owners should still enable secret scanning and push protection.

## Production use

Use opaque proxy URLs, strip identifying audio metadata and artwork, store Mapping in a restricted system, and define retention and deletion policies. The restored aggregate report contains real source identity and URLs and must remain administrator-only.

Please report security issues privately to the repository owner rather than opening a public issue with sensitive data.
