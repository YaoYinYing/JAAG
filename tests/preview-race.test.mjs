import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

test('edits and newer calculations prevent stale preview publication', async () => {
    const output = { textContent: 'previous' };
    const status = { textContent: '' };
    const document = {
        addEventListener() {},
        getElementById(id) { return id === 'jsonOutput' ? output : id === 'validationStatus' ? status : null; }
    };
    const context = { document, window: {}, setTimeout, clearTimeout, console };
    vm.runInNewContext(`${readFileSync(new URL('../js/app.js', import.meta.url), 'utf8')}\nthis.Generator = AlphaFold3Generator;`, context);
    const app = Object.create(context.Generator.prototype);
    const pending = [];
    app.getOutputTarget = () => 'alphafold3';
    app.buildSupersetDocument = () => {
        const work = deferred();
        pending.push(work);
        return work.promise;
    };
    app.validateJSON = () => ({ errors: [], warnings: [] });
    app.updateOutputTargetUI = () => {};
    app.updateValidationStatus = () => {};
    app.showError = message => { throw new Error(message); };
    const core = {
        TARGETS: { alphafold3: { name: 'AlphaFold 3', outputFormat: 'json' } },
        serialize: doc => ({ data: { name: doc.name }, errors: [], warnings: [] })
    };
    const result = name => ({ collectedJob: {}, inputDocument: { name }, core });

    const old = app.generateJSON();
    app.debounceGenerate();
    assert.equal(app.lastValidation, null);
    assert.match(status.textContent, /Updating/);
    pending[0].resolve(result('old'));
    await old;
    assert.equal(output.textContent, 'previous');
    assert.equal(app.lastValidation, null);
    clearTimeout(app.generateTimeout);

    const first = app.generateJSON();
    const second = app.generateJSON();
    pending[2].resolve(result('new'));
    await second;
    pending[1].resolve(result('stale'));
    await first;
    assert.equal(JSON.parse(output.textContent).name, 'new');
    assert.equal(app.lastInputDocument.name, 'new');
    assert.equal(app.lastValidation.valid, true);
});
