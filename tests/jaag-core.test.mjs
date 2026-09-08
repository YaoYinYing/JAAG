import test from 'node:test';
import assert from 'node:assert/strict';

import {
    build,
    buildAlphaFold3Job,
    buildSuperset,
    parseSeeds,
    serialize,
    validateSuperset
} from '../shared/index.mjs';

function complexModel() {
    return {
        name: 'glycoprotein_complex',
        seeds: [7, 11],
        version: 4,
        entities: [
            {
                type: 'protein',
                chainIds: ['A', 'B'],
                sequence: 'ACDEFGHIK',
                description: 'dimer',
                modifications: [{ ccdCode: 'MSE', position: 1 }],
                msa: {
                    paired: { source: 'path', value: '/data/paired.a3m' },
                    unpaired: { source: 'path', value: '/data/unpaired.a3m' }
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
    };
}

test('parseSeeds normalises int, string, and array inputs', () => {
    assert.deepEqual(parseSeeds(42), [42]);
    assert.deepEqual(parseSeeds('1, 2, 3'), [1, 2, 3]);
    assert.deepEqual(parseSeeds([1, 2, 2, 3]), [1, 2, 3]);
    assert.deepEqual(parseSeeds(''), []);
    assert.deepEqual(parseSeeds(null), []);
});

test('buildAlphaFold3Job produces the AlphaFold 3 dialect shape', () => {
    const job = buildAlphaFold3Job(complexModel());

    assert.equal(job.name, 'glycoprotein_complex');
    assert.deepEqual(job.modelSeeds, [7, 11]);
    assert.equal(job.dialect, 'alphafold3');
    assert.equal(job.version, 4);
    assert.equal(job.sequences.length, 2);
    assert.deepEqual(job.sequences[0].protein.id, ['A', 'B']);
    assert.deepEqual(job.sequences[0].protein.modifications, [{ ptmType: 'MSE', ptmPosition: 1 }]);
    assert.equal(job.sequences[0].protein.pairedMsaPath, '/data/paired.a3m');
    assert.deepEqual(job.sequences[1].ligand.ccdCodes, ['NAG', 'FUC']);
    assert.deepEqual(job.bondedAtomPairs, [[['A', 2, 'ND2'], ['G', 1, 'C1']]]);
    assert.equal(job.userCCD, 'data_XYZ\n#\n_chem_comp.id XYZ\n');
});

test('build superset + serialize to AlphaFold 3 round-trips', () => {
    const result = build(complexModel(), 'alphafold3');
    assert.deepEqual(result.errors, []);
    assert.equal(result.document.schema, 'jaag-superset');
    assert.deepEqual(result.data.sequences.slice(0, 2).length, 2);
    assert.equal(result.data.name, 'glycoprotein_complex');
});

test('build to OpenDDE emits a job list and maps CCD codes to CCD_ prefix', () => {
    const model = complexModel();
    delete model.customComponents;
    const result = build(model, 'opendde');
    assert.deepEqual(result.errors, []);
    assert.ok(Array.isArray(result.data));
    const job = result.data[0];
    assert.equal(job.name, 'glycoprotein_complex');
    assert.equal(job.sequences[1].ligand.ligand, 'CCD_NAG_FUC');
});

test('build to Boltz emits YAML strings', () => {
    const model = complexModel();
    delete model.customComponents;
    const result = build(model, 'boltz');
    assert.deepEqual(result.errors, []);
    assert.equal(typeof result.data, 'string');
    assert.match(result.data, /^version: 1/m);
    assert.match(result.data, /constraints:/m);
});

test('custom userCCD components are rejected for server-style targets', () => {
    const result = build(complexModel(), 'opendde');
    assert.ok(result.errors.some(message => /custom userCCD/.test(message)));
});

test('build to Chai-1 emits FASTA strings', () => {
    const result = build(complexModel(), 'chai');
    assert.match(result.data, /^>protein\|name=A/m);
});

test('file-backed ligands serialise for server-style targets only', () => {
    const model = {
        name: 'file_ligand',
        seeds: [1],
        entities: [
            { type: 'protein', chainIds: 'A', sequence: 'ACDE' },
            { type: 'ligand', chainIds: 'L', ligand: { source: 'file', path: 'lig.sdf' } }
        ]
    };
    const opendde = build(model, 'opendde');
    assert.deepEqual(opendde.errors, []);
    assert.equal(opendde.data[0].sequences[1].ligand.ligand, 'FILE_lig.sdf');

    const af3 = build(model, 'alphafold3');
    assert.ok(af3.errors.some(message => /ligand file paths/.test(message)));
});

test('build validates invalid model through the neutral schema', () => {
    const result = build({ name: 'x', seeds: [0], entities: [] }, 'alphafold3');
    assert.ok(result.errors.length > 0);
    assert.equal(result.data, null);
    assert.ok(result.errors.some(message => /seed/i.test(message)));
});

test('builder output document passes validateSuperset', () => {
    const model = complexModel();
    delete model.customComponents;
    const built = buildSuperset(model, 'protenix');
    assert.deepEqual(built.errors, []);
    assert.equal(validateSuperset(built.document).valid, true);
    const serialized = serialize(built.document, 'protenix');
    assert.deepEqual(serialized.errors, []);
});
