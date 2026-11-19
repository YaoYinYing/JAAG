import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('bond editor remains available for proteins and orphaned manual bonds', () => {
    const section = { innerHTML: '' };
    let bondContainer = null;
    const app = { sequences: [{ type: 'protein' }], bondedAtomPairs: [] };
    const document = { getElementById(id) {
        if (id === 'dynamicBondedAtomPairsSection') return section;
        if (id === 'bondedAtomPairsContainer') return bondContainer;
        return null;
    } };
    const context = { window: { app }, app, document, console };
    vm.runInNewContext(readFileSync(new URL('../js/sequences.js', import.meta.url), 'utf8'), context);
    context.updateBondedAtomPairsVisibility();
    assert.match(section.innerHTML, /Add Bond/);
    bondContainer = {};
    app.sequences = [];
    app.bondedAtomPairs.push({ id: 'bond_1', data: [['A', 1, 'CA'], ['L', 1, 'C1']] });
    context.updateBondedAtomPairsVisibility();
    assert.equal(app.bondedAtomPairs.length, 1);
    assert.match(section.innerHTML, /Add Bond/);
});

test('incomplete manual bonds block output validation', () => {
    function Generator() {}
    const context = { AlphaFold3Generator: Generator, window: {}, document: { getElementById() { return null; } }, console };
    vm.runInNewContext(readFileSync(new URL('../js/json-generator.js', import.meta.url), 'utf8'), context);
    const app = new Generator();
    app.bondedAtomPairs = [{ id: 'bond_1', data: {} }];
    app.validateSequences = () => ({ errors: [], warnings: [] });
    app.updateValidationStatus = () => {};
    const result = app.validateJSON({ name: 'Job', modelSeeds: [1], sequences: [{}], version: 4, dialect: 'alphafold3' });
    assert.equal(result.valid, false);
    assert.match(result.errors.join('; '), /Complete or remove each covalent bond/);
});
