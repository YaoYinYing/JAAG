const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../js/opendde-adapter.js');

function baseJob(sequences) {
    return {
        name: 'jaag_test',
        modelSeeds: [101],
        dialect: 'alphafold3',
        version: 4,
        sequences
    };
}

test('converts entity names, multiplicity, modifications, and MSA paths', () => {
    const result = adapter.convert(baseJob([
        {
            protein: {
                id: ['A', 'B'],
                sequence: 'AC',
                modifications: [{ ptmType: 'MSE', ptmPosition: 1 }],
                pairedMsaPath: '/data/paired.a3m',
                unpairedMsaPath: '/data/unpaired.a3m'
            }
        },
        {
            dna: {
                id: 'D',
                sequence: 'ATGC',
                modifications: [{ modType: '6MA', modPosition: 2 }]
            }
        },
        {
            rna: {
                id: 'R',
                sequence: 'AUGC',
                modifications: [{ modType: '5MC', modPosition: 3 }],
                unpairedMsaPath: '/data/rna.a3m'
            }
        }
    ]));

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, [{
        name: 'jaag_test',
        modelSeeds: [101],
        sequences: [
            {
                proteinChain: {
                    count: 2,
                    id: ['A', 'B'],
                    sequence: 'AC',
                    modifications: [{ ptmType: 'CCD_MSE', ptmPosition: 1 }],
                    unpairedMsaPath: '/data/unpaired.a3m',
                    pairedMsaPath: '/data/paired.a3m'
                }
            },
            {
                dnaSequence: {
                    count: 1,
                    id: ['D'],
                    sequence: 'ATGC',
                    modifications: [{ modificationType: 'CCD_6MA', basePosition: 2 }]
                }
            },
            {
                rnaSequence: {
                    count: 1,
                    id: ['R'],
                    sequence: 'AUGC',
                    modifications: [{ modificationType: 'CCD_5MC', basePosition: 3 }],
                    unpairedMsaPath: '/data/rna.a3m'
                }
            }
        ]
    }]);
});

test('converts CCD glycans, SMILES, and chain bonds to entity-copy bonds', () => {
    const job = baseJob([
        { protein: { id: ['A', 'B'], sequence: 'NNST' } },
        { ligand: { id: ['GA', 'GB'], ccdCodes: ['NAG', 'BMA'] } },
        { ligand: { id: 'L', smiles: 'CCO' } }
    ]);
    job.bondedAtomPairs = [
        [['B', 2, 'ND2'], ['GB', 1, 'C1']],
        [['GB', 1, 'O4'], ['GB', 2, 'C1']]
    ];

    const result = adapter.convert(job);

    assert.deepEqual(result.errors, []);
    assert.equal(result.data[0].sequences[1].ligand.ligand, 'CCD_NAG_BMA');
    assert.equal(result.data[0].sequences[2].ligand.ligand, 'CCO');
    assert.deepEqual(result.data[0].covalent_bonds, [
        {
            entity1: '1', copy1: 2, position1: '2', atom1: 'ND2',
            entity2: '2', copy2: 2, position2: '1', atom2: 'C1'
        },
        {
            entity1: '2', copy1: 2, position1: '1', atom1: 'O4',
            entity2: '2', copy2: 2, position2: '2', atom2: 'C1'
        }
    ]);
});

test('normalizes JAAG AlphaFold-only CCD aliases', () => {
    const job = baseJob([{ ligand: { id: 'G', ccdCodes: ['SIA-2', 'NAG'] } }]);
    job.userCCD = 'data_SIA-2\n#\n_chem_comp.id SIA\n';

    const result = adapter.convert(job);

    assert.deepEqual(result.errors, []);
    assert.equal(result.data[0].sequences[0].ligand.ligand, 'CCD_SIA_NAG');
    assert.match(result.warnings[0], /standard CCD IDs/);
});

test('rejects unsupported AlphaFold-only inputs and invalid chain references', () => {
    const job = baseJob([
        {
            protein: {
                id: 'A',
                sequence: 'AC',
                unpairedMsa: '>query\nAC',
                templates: [{ mmcifPath: '/data/template.cif' }]
            }
        }
    ]);
    job.userCCD = 'data_CUSTOM-1\n#\n_chem_comp.id CUSTOM\n';
    job.bondedAtomPairs = [[['A', 1, 'CA'], ['Z', 1, 'C1']]];

    const result = adapter.convert(job);

    assert.match(result.errors.join('\n'), /inline MSA data is unsupported/);
    assert.match(result.errors.join('\n'), /AlphaFold template objects/);
    assert.match(result.errors.join('\n'), /custom userCCD components: CUSTOM-1/);
    assert.match(result.errors.join('\n'), /unknown chain ID: Z/);
});

test('rejects duplicate chain IDs and validates the OpenDDE envelope', () => {
    const result = adapter.convert(baseJob([
        { protein: { id: 'A', sequence: 'AC' } },
        { dna: { id: 'A', sequence: 'AT' } }
    ]));

    assert.match(result.errors.join('\n'), /Duplicate chain ID: A/);
    assert.deepEqual(adapter.validate(result.data), { valid: true, errors: [], warnings: [] });
    assert.equal(adapter.validate({}).valid, false);
    assert.equal(adapter.validate([{ name: 'empty', sequences: [{ proteinChain: { count: 1, sequence: '' } }] }]).valid, false);
});
