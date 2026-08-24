# Reference

Exact surfaces, transcribed from the implementation.

- [CLI](cli.md) — every command, flag, default and exit code.
- [Config schema](config-schema.md) — every `catalog.config.json` field and the
  rules the loader enforces.
- [CI rendering](ci-rendering.md) — what `ocx-catalog ci` emits, the generated
  header contract, pin carry-forward and the drift check.
- [Output layout](output-layout.md) — what a build writes into `dist/`.

The machine-readable schema ships in the published package at
`src/config/schema/catalog.config.schema.json`; point your editor's `$schema`
at it for inline validation. Release history lives in
[CHANGELOG.md](https://github.com/ocx-sh/catalog/blob/main/CHANGELOG.md).
