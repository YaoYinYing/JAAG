const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../js/opendde-adapter.js');

test('converts a JAAG job to the official Protenix job-list shape', () => {
    const result = adapter.convert({
        name: 'protenix_test',
        modelSeeds: [1, 2, 3],
        dialect: 'alphafold3',
        version: 4,
        sequences: [
            { protein: { id: ['A', 'B'], sequence: 'ACDE' } },
            { dna: { id: 'D', sequence: 'ATGC' } },
            { ligand: { id: 'L', ccdCodes: ['NAG', 'BMA'] } }
        ]
    }, 'Protenix');

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, [{
        name: 'protenix_test',
        modelSeeds: [1, 2, 3],
        sequences: [
            { proteinChain: { count: 2, id: ['A', 'B'], sequence: 'ACDE' } },
            { dnaSequence: { count: 1, id: ['D'], sequence: 'ATGC' } },
            { ligand: { count: 1, id: ['L'], ligand: 'CCD_NAG_BMA' } }
        ]
    }]);
    assert.deepEqual(adapter.validate(result.data, 'Protenix'), {
        valid: true,
        errors: [],
        warnings: []
    });
});

test('uses Protenix in target-specific compatibility errors', () => {
    const result = adapter.convert({
        name: 'invalid',
        sequences: [{ protein: { id: 'A', sequence: 'AC', unpairedMsa: '>query\nAC' } }]
    }, 'Protenix');

    assert.match(result.errors.join('\n'), /Protenix requires MSA file paths/);
    assert.match(adapter.validate([], 'Protenix').errors[0], /Protenix JSON/);
});

test('exports JAAG built-in sulfated glycans for Protenix', () => {
    const result = adapter.convert({
        name: 'sulfated_glycan',
        sequences: [{ ligand: { id: 'G', ccdCodes: ['NAG', 'SO4-2'] } }],
        userCCD: 'data_SO4-2\n#\n_chem_comp.id SO4\n'
    }, 'Protenix');

    assert.deepEqual(result.errors, []);
    assert.equal(result.data[0].sequences[0].ligand.ligand, 'CCD_NAG_SO4');
});
