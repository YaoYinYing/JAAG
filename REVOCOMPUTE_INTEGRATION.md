# REvoCompute integration for `jaag-core`

This document describes the dependency-free JAAG core extracted into
`shared/`, the two distributable bundles built from it, the REvoCompute
input-workspace plugin contract that the builder bundle satisfies, and the
exact steps to replace the duplicated `jaag-builder` stubs in the
[REvoCompute](https://github.com/chinchc/JAAG) Docker runners.

---

## 1. What `jaag-core` is

`shared/` is a pure, DOM-free, dependency-free Node/ESM package named
`jaag-core`. It owns the conversion pipeline that powers the JAAG web form:

1. A host (the JAAG page, a REvoCompute workspace plugin, or any other tool)
   constructs a **JAAG input model** — a plain object that is intentionally
   close to the neutral schema so it needs no UI to produce.
2. `buildSuperset()` normalises that model into a neutral
   `jaag-superset` document.
3. `validateSuperset()` gate-keeps the document against the neutral schema.
4. `serialize()` dispatches the document through a per-target adapter and
   emits the target-native input file.

Supported targets:

| Target id    | Adapter output                     |
| ------------ | ---------------------------------- |
| `alphafold3` | AlphaFold 3 JSON job object        |
| `opendde`    | OpenDDE server-style job list      |
| `protenix`   | Protenix server-style job list     |
| `openfold3`  | OpenFold 3 `queries` JSON object   |
| `chai`       | Chai-1 FASTA string                |
| `boltz`      | Boltz YAML string                  |

Package layout:

```
shared/
  index.mjs           # public entry point
  builder.mjs         # model -> superset -> target-file pipeline
  jaag-schema.mjs     # neutral schema, validation, and target adapters
  share-payload.mjs   # base64url/deflate share-link codec
  package.json        # "jaag-core", pure ESM, no dependencies
```

The package is intentionally dependency-free and DOM-free: the same code runs
under Node's test runner, inside the JAAG browser form, and inside a
REvoCompute workspace plugin loaded with a plain `<script>` tag.

---

## 2. Public API

`jaag-core`'s entry point (`shared/index.mjs`) re-exports:

| Export | Kind | Purpose |
| --- | --- | --- |
| `SCHEMA_NAME` | `'jaag-superset'` | Neutral schema identifier |
| `SCHEMA_VERSION` | `1` | Neutral schema version |
| `TARGETS` | object | Frozen registry of target metadata (`name`, `outputFormat`, capabilities) |
| `ADAPTERS` | object | Frozen registry of target serialisers |
| `validateSuperset(document)` | function | Returns `{ valid, errors, warnings }` |
| `serialize(document, target?)` | function | Returns `{ data, errors, warnings }` |
| `fromAlphaFold3(job, options?)` | function | Converts an AlphaFold 3 job into a neutral document |
| `buildSuperset(model, target?)` | function | Converts an input model into `{ document, errors, warnings }` |
| `buildAlphaFold3Job(model)` | function | Converts an input model into the AlphaFold 3 dialect job (throws on schema errors) |
| `build(model, target?)` | function | Full pipeline into `{ data, document, job, errors, warnings }` |
| `parseSeeds(seeds)` | function | Normalises int / comma-string / array model seeds |
| `encodeSharePayload(document, deflate)` | function | Compresses a document to a base64url share payload |
| `decodeSharePayload(value, inflate)` | async function | Reverses `encodeSharePayload` |
| `toBase64Url(bytes)` / `fromBase64Url(value)` | function | base64url helpers |
| `inflateWithDecompressionStream(compressed)` | async function | Browser `DecompressionStream` inflate adapter |
| `MAX_COMPRESSED_BYTES` / `MAX_DECOMPRESSED_BYTES` | number | Share-payload size limits |

### Input model shape

`build(model, target)` consumes a host-supplied object (the "input model"):

```js
build({
  name: 'glycoprotein_complex',
  seeds: [7, 11],            // number | string | array
  version: 4,                // optional, AlphaFold 3 1..4
  entities: [
    {
      type: 'protein',       // 'protein' | 'dna' | 'rna' | 'ligand'
      chainIds: ['A', 'B'],  // or a single string, e.g. 'A'
      sequence: 'ACDEFGHIK',
      modifications: [{ ccdCode: 'MSE', position: 1 }],
      msa: {
        unpaired: { source: 'path', value: '/data/unpaired.a3m' },
        paired:   { source: 'path', value: '/data/paired.a3m' }
      }
    },
    {
      type: 'ligand',
      chainIds: 'G',
      ligand: { source: 'ccd', ccdCodes: ['NAG', 'FUC'] }
    }
  ],
  bonds: [[['A', 2, 'ND2'], ['G', 1, 'C1']]],
  customComponents: { inline: 'data_XYZ\n#\n_chem_comp.id XYZ\n' }
}, 'alphafold3');
```

`chainIds` accepts either a single string (for one chain) or an array of
chain-ID strings. `parseSeeds()` likewise accepts a number, a
comma/space-separated string, or an array.

---

## 3. Building the two dist bundles

From the JAAG repository root:

```bash
node scripts/build-global.mjs
node scripts/build-revocompute-plugin.mjs
```

| Command | Output |
| --- | --- |
| `node scripts/build-global.mjs` | `dist/jaag-core.global.js` |
| `node scripts/build-revocompute-plugin.mjs` | `dist/jaag-builder.revo.js` |

- `dist/jaag-core.global.js` bundles `jaag-schema.mjs`, `share-payload.mjs`,
  and `builder.mjs` into a single IIFE that assigns `globalThis.JAAGCore`
  (`window` in a browser, and `module.exports` under CommonJS when present).
  It exposes the full public API above as `JAAGCore.*`.

- `dist/jaag-builder.revo.js` concatenates the JAAG core global bundle with
  the canonical REvoCompute plugin source
  (`integration/revocompute/jaag-builder/index.js`) into one standalone file.
  Loading this single file first attaches `globalThis.JAAGCore` and then
  registers the `jaag-builder` input-workspace plugin.

Both bundles are generated artifacts; rebuild them whenever
`shared/*.mjs` or `integration/revocompute/jaag-builder/index.js` changes.
Do not hand-edit `dist/`.

---

## 4. REvoCompute input-workspace plugin contract

REvoCompute loads an input workspace in two stages:

1. `revocompute/static/js/input-workspace.js` creates
   `global.REvoComputeInputWorkspace = { InputWorkspace, registry }`, where
   `registry` is a `PluginRegistry("input")`.
2. Runner-owned plugin modules are fetched by their descriptor (`module_url`)
   and executed with a plain `<script>` tag; each module registers itself via
   `workspaceApi.registry.register({ id, mount })`.

A runner family declares the plugin in its `plugin.yaml`
`contributions.input_workspace_plugins` block, e.g. the AlphaFold 3 runner:

```yaml
contributions:
  input_workspace_plugins:
  - id: jaag-builder
    module: workspace/jaag-builder/index.js
    styles:
    - workspace/jaag-builder/style.css
    configuration_schema: workspace/jaag-builder/schema.json
```

`dist/jaag-builder.revo.js` satisfies this contract as follows:

- It requires `global.REvoComputeInputWorkspace` to already exist (the
  `input-workspace.js` module must be loaded first) and registers
  `workspaceApi.registry.register(...)` with `id: "jaag-builder"` and a
  `mount(target, definition, context)` function.
- `mount()` returns a controller object with the methods the workspace plugin
  host calls:
  - `refresh()` — rebuild the model and re-materialise the generated file;
  - `readValue()` — return `{ schema: 'jaag-superset', target, model }`;
  - `summarize()` — return `{ label, value }` for the review step;
  - `validate()` — return an array of error strings (empty when valid);
  - `destroy()` — clear the generated file and any listeners.
- It uses the context API supplied by the host:
  - `context.setGeneratedFile(file)` — publish the synthesised input file
    (`new File([...], "jaag-<target>.json", { type: "application/json" })`);
  - `context.changed()` — notify the workspace that state changed;
  - `context.form` — the active task form definition.

The plugin accepts these `definition.options` keys (validated by REvoCompute's
`jaag-builder` option schema):

| Option | Default | Meaning |
| --- | --- | --- |
| `target` | first allowed target | Target id for the generated file |
| `targets` | `["alphafold3", "opendde"]` | Allowed target ids for the selector |

The source plugin at `integration/revocompute/jaag-builder/index.js` is the
canonical, editable form of this contract and depends on `global.JAAGCore`
being preloaded; the standalone bundle in
`dist/jaag-builder.revo.js` is the deployment form used by the runners because
it carries the core with it.

---

## 5. Replacing the two duplicated runner stubs

REvoCompute currently ships two near-identical, placeholder implementations of
the `jaag-builder` workspace plugin:

- `../REvoCompute/docker/runners/alphafold3/workspace/jaag-builder/`
- `../REvoCompute/docker/runners/opendde/workspace/jaag-builder/`

Each contains `index.js` (the duplicated stub), `schema.json` (target enum),
and `style.css`. Only `index.js` is the duplicated logic that this
repository replaces.

> These steps are written as documentation only. This repository's changes
> are confined to JAAG; the copy commands below are for the person applying
> the integration inside the REvoCompute checkout.

1. Rebuild the bundles (see §3):

   ```bash
   node scripts/build-global.mjs
   node scripts/build-revocompute-plugin.mjs
   ```

2. Copy the standalone bundle over each runner's stub `index.js`:

   ```bash
   cp dist/jaag-builder.revo.js \
     ../REvoCompute/docker/runners/alphafold3/workspace/jaag-builder/index.js

   cp dist/jaag-builder.revo.js \
     ../REvoCompute/docker/runners/opendde/workspace/jaag-builder/index.js
   ```

3. Keep each runner's `schema.json` unchanged — it constrains the plugin's
   `target` option per runner:
   - AlphaFold 3: `{"properties": {"target": {"enum": ["alphafold3"]}}}`
   - OpenDDE: `{"properties": {"target": {"enum": ["opendde"]}}}`

   Keep `style.css` unchanged too. The `plugin.yaml` files already point
   `module` at `workspace/jaag-builder/index.js`, so no manifest change is
   needed.

4. Verify inside REvoCompute (run its JS contract and plugin-discovery tests,
   e.g. `node tests/js/test_contracts.js` and the Python workspace-plugin
   tests). The JAAG-side contract test for the identical bundle is
   `tests/jaag-revocompute-plugin.test.mjs`.

Each runner now loads the real builder-backed plugin: it seeds one protein
entity, validates live through `JAAGCore.build`, reports errors in the
workspace, and synthesises `jaag-<target>.json` as the generated input file
for the selected runner.

---

## 6. Testing this repository

```bash
npm test
```

This runs every `tests/*.test.mjs` file, including:

- `tests/jaag-core.test.mjs` — `shared/` pipeline and target adapters;
- `tests/jaag-core-global.test.mjs` — the `dist/jaag-core.global.js` bundle
  loaded in a VM without a DOM;
- `tests/jaag-revocompute-plugin.test.mjs` — the standalone plugin bundle
  loaded with the same `new Function("global", "window", "document", code)`
  harness shape REvoCompute uses in `tests/js/test_contracts.js`, then mounted
  and exercised against a minimal DOM.

---

## 7. Publication record

- Branch: `feat/jaag-core-revocompute-reuse`
- Commit: `021e0dae3066369e2dad5b8a199796904ffbc30d`
  (`git log --oneline -1` → `021e0da Extract jaag-core and canonical REvoCompute builder plugin`)
- Pull request: https://github.com/YaoYinYing/JAAG/pull/6
  (head `feat/jaag-core-revocompute-reuse` → base `main` on `YaoYinYing/JAAG`)

The pull request was opened with `gh pr create -R YaoYinYing/JAAG --base main
--head feat/jaag-core-revocompute-reuse ...` on 2026-09-08.

### Manual commands if automation is unavailable

```bash
cd /Users/yyy/Documents/protein_design/JAAG
git checkout -b feat/jaag-core-revocompute-reuse
git add shared integration scripts tests REVOCOMPUTE_INTEGRATION.md
git add -f dist/jaag-core.global.js dist/jaag-builder.revo.js
git commit -m "Extract jaag-core and canonical REvoCompute builder plugin"
git push -u origin feat/jaag-core-revocompute-reuse
gh pr create --base main --head feat/jaag-core-revocompute-reuse \
  --title "Extract jaag-core and canonical REvoCompute builder plugin" \
  --body "See REVOCOMPUTE_INTEGRATION.md for motivation, API, build steps, and runner stub replacement."
```

Note: `dist/` is listed in `.gitignore`, so the two generated bundles must be
added with `git add -f` if they are to be committed.
