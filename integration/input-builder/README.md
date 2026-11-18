# BioNuTA Input Builder

`index.mjs` mounts the same workbench used by the standalone page. It isolates
instances in iframes and fixes the target per instance. This adapter requires
that the editor URL and host have the **same scheme, host and port**: host and
editor can directly access each other's DOM and are in the same trust boundary.
For separate deployments, serve the editor on the host origin (for example,
under a reverse-proxied path). It is not a cross-origin message bridge. No
scientific state is placed in the iframe URL, browser storage or analytics.
The workbench and SugarDrawer runtime assets are pinned and served locally.
Optional UniProt and glycan lookups send the explicitly selected accession or
glycan structure to external services; the embedded workbench hides glycan
lookup. In SugarDrawer, Search, Normalize, WURCS import/export and SVG export
send the structure to GlyCosmos. GlycoCT drawing and one-click export are local.
The host adapter does not automatically transfer private input.

Serve the repository as static files at its existing paths, then open
`integration/input-builder/harness.html` for the host-neutral in-memory example.
It demonstrates an independent upload, builder-owned output, supporting files,
clone/restore and edit invalidation. It does not submit a job or integrate a
production host. The existing `dist/jaag-builder.revo.js` registry plugin and
`JAAGCore` remain separate, compatible legacy artifacts.

```js
import { mount } from './integration/input-builder/index.mjs';

const builder = await mount(document.querySelector('#builder'), {
  target: 'opendde', // fixed for this instance
  // editorURL: '/jaag/index.html', // optional; same origin, no query or fragment
});

// The host owns role files. Remove only the output it created, never an upload.
let owned = null;
const unsubscribe = builder.subscribe(() => {
  if (owned && host.currentInput() === owned) host.clearInput();
  owned = null;
});

const slots = await builder.listDependencies();
// Ask the user or authorized host storage for bytes for each logical slot.
// The resolver receives no original local path or URL.
const captured = await builder.materialize(async (slot, { signal }) => {
  const file = await host.authorizedFileFor(slot, { signal });
  return file && { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
});
// Recheck role ownership after async work. Do not replace an independent upload.
if (host.currentInput() && host.currentInput() !== owned) throw new Error('Input role is occupied');
owned = new File([captured.output.bytes], captured.output.name, { type: captured.output.mime });
host.setInput(owned);
// Persist captured.snapshot and captured.dependencies separately under host authorization.
// To reconstruct, supply bytes by logical ID; digest and size are checked.
await builder.restore(captured.snapshot, async (item, { signal }) => host.readDependency(item.id, { signal }));
// When the host removes the workspace:
unsubscribe();
builder.destroy();
```

The `host` object above is illustrative; no global registry or REvoCompute API
is required. The host maps the returned logical `input` role and dependencies
to its own declared roles and runner-relative file locations. It owns
permissions, acceptance, storage and task submission. Keep snapshot, output
SHA-256, output revision and dependency bytes together; an edit invalidates a
builder-owned output. The host must check role ownership again after async work
as shown, including changes made by other capabilities.

## Lifecycle and data

- `mount(container, {target, editorURL?})` resolves once the editor and core are
  ready. Each instance has its own iframe. A failed load or unsupported target
  rejects; the host can offer ordinary file upload.
- `validate()` returns errors, warnings and a revision. `listDependencies()`
  lists logical slots without original paths. `snapshot(resolver?)` returns a
  versioned `bionuta` envelope and separate verified dependency bytes.
  `materialize(resolver?)` returns that snapshot, a target-native byte payload,
  supporting files, diagnostics, revision and output SHA-256. Its displayed
  preview uses those same output bytes.
- `restore(snapshot, resolver?)` verifies the envelope and dependency hashes,
  rebuilds the state in a fresh hidden iframe and swaps it in only if the old
  editor has not changed. Failed restore leaves the active editor intact.
  The host resolver receives an `AbortSignal`; `destroy()` aborts pending calls,
  removes frames and listeners, and makes further operations fail. Hosts should
  also stop their own I/O when the signal aborts.
- `subscribe(fn)` reports editor changes and returns an unsubscribe function.
  The host must invalidate only its own output, and must not submit a task
  automatically. The example host does not persist snapshots.

Snapshots carry builder/version, neutral document schema/version, target,
revision, the `jaag-superset` document, glycan authoring source and custom CCD
editor information, the count of explicitly authored bonds, plus dependency
metadata. The neutral document includes generated glycan entities and bonds;
the authoring data lets restore recreate their editable sources. File bytes are separate. An
unsupported version, unknown field, invalid state, changed revision, missing
file, unsafe path or mismatched digest causes an error. Current capture requires
valid input. It rejects inactive ligand/MSA data rather than discarding it,
unfinished custom CCD input, multiple different custom CCD paths, and legacy
entities that have no editable form. Template slots use their index within an
entity; changing their order can change slot IDs. These are current limitations,
not claims that target-native import is lossless. Existing standalone share and
input import remain distinct from native snapshot restoration.

## Development verification

`npm test` runs DOM-free tests. `npm ci` and `npm run build:vendor` reproduce
the checked-in static browser assets. For the SugarDrawer smoke test, run
`npm --prefix sugardrawer ci` and `npm --prefix sugardrawer run build` first.
`npx playwright install chromium` and `npm run test:browser` run the
real-browser harness tests. To use
an installed Chromium-compatible browser, set `BIONUTA_CHROMIUM_PATH` to its
executable. These tests do not run inference or demonstrate production host
integration. The current REvoCompute workspace plugin is module-based and its
clone flow has separate persistence and authorization requirements; mapping
this API into that lifecycle remains downstream work.
