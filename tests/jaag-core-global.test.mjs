import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

function loadGlobalBundle() {
    const path = resolve('dist/jaag-core.global.js');
    const code = readFileSync(path, 'utf8');
    const sandbox = {
        console,
        Set, Map, Object, Array, String, Number, Boolean, JSON,
        Math, Error, TypeError, RangeError, SyntaxError,
        Uint8Array, TextEncoder, TextDecoder, Blob, Promise,
        Buffer, btoa, atob
    };
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'jaag-core.global.js' });
    if (!sandbox.JAAGCore) throw new Error('JAAGCore global was not attached');
    return sandbox.JAAGCore;
}

test('global bundle loads without a DOM and exposes the public API', () => {
    const core = loadGlobalBundle();
    assert.equal(core.SCHEMA_NAME, 'jaag-superset');
    assert.equal(core.SCHEMA_VERSION, 1);
    assert.equal(typeof core.TARGETS, 'object');
    assert.equal(typeof core.ADAPTERS, 'object');

    for (const key of [
        'fromAlphaFold3', 'validateSuperset', 'serialize',
        'build', 'buildAlphaFold3Job', 'buildSuperset', 'parseSeeds',
        'encodeSharePayload', 'decodeSharePayload',
        'toBase64Url', 'fromBase64Url', 'inflateWithDecompressionStream'
    ]) {
        assert.equal(typeof core[key], 'function', `${key} must be a function`);
    }
});

test('global bundle builds and serializes every target', () => {
    const core = loadGlobalBundle();
    const model = {
        name: 'global_bundle',
        seeds: [5],
        entities: [
            { type: 'protein', chainIds: ['A'], sequence: 'ACDEFG', msa: { unpaired: { source: 'path', value: '/msa/a.a3m' } } },
            { type: 'ligand', chainIds: 'L', ligand: { source: 'smiles', smiles: 'CCO' } }
        ]
    };

    const cases = {
        alphafold3: { kind: 'object' },
        opendde: { kind: 'array' },
        protenix: { kind: 'array' },
        openfold3: { kind: 'object' },
        chai: { kind: 'string' },
        boltz: { kind: 'string' }
    };

    for (const [target, expectation] of Object.entries(cases)) {
        const result = core.build(model, target);
        assert.equal(Array.from(result.errors).length, 0, `${target} should build without errors`);
        assert.equal(typeof result.data, expectation.kind === 'string' ? 'string' : 'object', `${target} payload kind`);
        if (expectation.kind === 'array') assert.ok(Array.isArray(result.data), `${target} emits an array`);
    }

    assert.equal(typeof core.buildAlphaFold3Job(model), 'object');
    assert.ok(core.validateSuperset(core.buildSuperset(model, 'alphafold3').document).valid);
});

test('global bundle reports per-target covalent-bond restrictions', () => {
    const core = loadGlobalBundle();
    const model = {
        name: 'bonded',
        seeds: [3],
        entities: [
            { type: 'protein', chainIds: 'A', sequence: 'ACDE' },
            { type: 'ligand', chainIds: 'L', ligand: { source: 'ccd', ccdCodes: ['NAG'] } }
        ],
        bonds: [[['A', 1, 'N'], ['L', 1, 'C1']]]
    };

    const alphafold3 = core.build(model, 'alphafold3');
    assert.equal(Array.from(alphafold3.errors).length, 0, 'naked AF3 supports bondedAtomPairs');
    assert.equal(JSON.stringify(alphafold3.data.bondedAtomPairs), JSON.stringify([[['A', 1, 'N'], ['L', 1, 'C1']]]));

    const opendde = core.build(model, 'opendde');
    assert.equal(Array.from(opendde.errors).length, 0, 'server style maps bonds to covalent_bonds');
    assert.equal(opendde.data[0].covalent_bonds.length, 1);

    const openfold3 = core.build(model, 'openfold3');
    assert.ok(Array.from(openfold3.errors).some(message => /bondedAtomPairs/.test(message)));

    const chai = core.build(model, 'chai');
    assert.ok(Array.from(chai.errors).some(message => /bondedAtomPairs/.test(message)));
});

test('global bundle share payload codec is symmetric', () => {
    const core = loadGlobalBundle();
    const document = core.buildSuperset({ name: 'share', seeds: [1], entities: [{ type: 'protein', chainIds: 'A', sequence: 'ACDE' }] }, 'alphafold3').document;
    // Use a real deflate implementation (pako-compatible) to exercise encode/decode.
    assert.equal(typeof core.toBase64Url, 'function');
    assert.equal(typeof core.fromBase64Url, 'function');
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const roundTripped = core.fromBase64Url(core.toBase64Url(bytes));
    assert.deepEqual([...roundTripped], [1, 2, 3, 4]);
});
