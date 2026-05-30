# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Cursor Engineering Coach, please **do not** open a
public GitHub issue. Instead, report it privately to the maintainers using GitHub's
[private vulnerability reporting](https://github.com/prd-dat-tran/Cursor-Engineering-Coach/security/advisories/new)
feature.

We will acknowledge your report within 5 business days, investigate the issue, and coordinate a fix
and disclosure timeline with you.

## Scope

Cursor Engineering Coach is a read-only extension that runs entirely on your local machine. It does
not collect telemetry and does not send your session data to any external service. The security
surface is therefore limited to:

- Local file parsing of Cursor session logs and rules files
- Optional language-model calls explicitly invoked by the user
- The packaged JavaScript bundle distributed via the `.vsix`

Reports about any of the above are in scope.
