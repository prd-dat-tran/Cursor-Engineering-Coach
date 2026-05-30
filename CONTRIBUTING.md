# Contributing to Cursor Engineering Coach

This project welcomes contributions and suggestions. By submitting a pull request, you agree that
your contribution is licensed under the project's [MIT License](LICENSE).

## How to Contribute

1. **Fork** the repository and create your branch from `main`.
2. **Install dependencies**: `npm install`
3. **Build**: `npm run build`
4. **Run tests**: `npm test`
5. **Lint**: `npm run lint`
6. If you've added code, add tests that cover your changes.
7. Ensure the test suite passes and linting is clean.
8. Submit a **pull request**.

## Reporting Issues

Please use [GitHub Issues](https://github.com/prd-dat-tran/Cursor-Engineering-Coach/issues) to report
bugs or request features. Before filing a new issue, please check if one already exists.

## Security

If you discover a security vulnerability, please follow the instructions in [SECURITY.md](SECURITY.md).
**Do not** report security vulnerabilities through public GitHub issues.

## Creating Rules and Metrics

Detection rules and metrics are the primary extensibility surface of Cursor Engineering Coach. Each
one is a self-contained markdown file with YAML frontmatter and a small DSL — no code changes
required to ship a new one. Built-in rules live in [`src/core/rules/`](src/core/rules/) and metrics
in [`src/core/metrics/`](src/core/metrics/).

See [docs/AUTHORING_RULES.md](docs/AUTHORING_RULES.md) for the full authoring guide: file format,
annotated rule and metric examples, the local testing workflow, and links to the DSL reference.

## Upstream

This project is a fork of [microsoft/AI-Engineering-Coach](https://github.com/microsoft/AI-Engineering-Coach).
If you find a bug that also affects the upstream extension, consider filing it there as well so both
communities benefit.
