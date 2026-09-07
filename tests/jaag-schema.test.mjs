import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ADAPTERS,
    SCHEMA_NAME,
    SCHEMA_VERSION,
    TARGETS,
    fromAlphaFold3,
    serialize,
    validateSuperset
} from '../shared/jaag-schema.mjs';

function alphaFoldFixture() {
    return {
        name: 'superset_test',
        modelSeeds: [7, 11],
        dialect: 'alphafold3',
        version: 4,
        sequences: [
            {
                protein: {
                    id: ['A', 'B'],
                    sequence: 'ACDE',
                    description: 'dimer',
                    modifications: [{ ptmType: 'MSE', ptmPosition: 1 }],
                    pairedMsaPath: '/data/paired.a3m',
                    unpairedMsaPath: '/data/unpaired.a3m'
                }
            },
            {
                ligand: {
                    id: 'G',
                    ccdCodes: ['NAG', 'SO4-2']
                }
            }
        ],
        bondedAtomPairs: [[['A', 2, 'ND2'], ['G', 1, 'C1']]],
        userCCD: 'data_SO4-2\n#\n_chem_comp.id SO4\n'
    };
}

test('creates a versioned neutral superset document', () => {
    const document = fromAlphaFold3(alphaFoldFixture(), { target: 'protenix' });

    assert.equal(document.schema, SCHEMA_NAME);
    assert.equal(document.schemaVersion, SCHEMA_VERSION);
    assert.equal(document.target, 'protenix');
    assert.deepEqual(document.job.entities[0].chainIds, ['A', 'B']);
    assert.deepEqual(document.job.entities[0].modifications, [{ ccdCode: 'MSE', position: 1 }]);
    assert.deepEqual(document.job.entities[0].msa, {
        unpaired: { source: 'path', value: '/data/unpaired.a3m' },
        paired: { source: 'path', value: '/data/paired.a3m' }
    });
    assert.deepEqual(document.job.bonds[0].left, { chainId: 'A', position: 2, atom: 'ND2' });
    assert.equal(validateSuperset(document).valid, true);
});

test('round-trips AlphaFold 3 through the neutral schema', () => {
    const source = alphaFoldFixture();
    const result = serialize(fromAlphaFold3(source), 'alphafold3');

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data, source);
});

test('dispatches OpenDDE and Protenix through distinct adapters', () => {
    const document = fromAlphaFold3(alphaFoldFixture());
    const openDDE = serialize(document, 'opendde');
    const protenix = serialize(document, 'protenix');

    assert.notEqual(ADAPTERS.opendde, ADAPTERS.protenix);
    assert.notEqual(ADAPTERS.opendde.serialize, ADAPTERS.protenix.serialize);
    assert.deepEqual(openDDE.data, protenix.data);
    assert.deepEqual(openDDE.errors, []);
    assert.deepEqual(protenix.errors, []);
    assert.match(openDDE.warnings.join('\n'), /OpenDDE/);
    assert.match(protenix.warnings.join('\n'), /Protenix/);
});

test('target registry declares capabilities explicitly', () => {
    assert.equal(TARGETS.alphafold3.capabilities.inlineMsa, true);
    assert.equal(TARGETS.opendde.capabilities.inlineMsa, false);
    assert.equal(TARGETS.protenix.capabilities.msaPaths, true);

    const result = serialize(fromAlphaFold3(alphaFoldFixture()), 'constructor');
    assert.equal(result.data, null);
    assert.match(result.errors.join('\n'), /Unsupported target: constructor/);
});

test('rejects invalid superset invariants before dispatch', () => {
    const document = fromAlphaFold3(alphaFoldFixture());
    document.job.entities[1].chainIds = ['A'];
    document.job.bonds[0].right.chainId = 'missing';

    const result = serialize(document, 'alphafold3');

    assert.equal(result.data, null);
    assert.match(result.errors.join('\n'), /Duplicate chain ID: A/);
    assert.match(result.errors.join('\n'), /unknown chain ID: missing/);
});

test('keeps inline MSA target compatibility in adapter validation', () => {
    const source = alphaFoldFixture();
    delete source.sequences[0].protein.unpairedMsaPath;
    delete source.sequences[0].protein.pairedMsaPath;
    source.sequences[0].protein.unpairedMsa = '>query\nACDE';
    source.sequences[0].protein.pairedMsa = '>query\nACDE';
    const document = fromAlphaFold3(source);

    assert.deepEqual(serialize(document, 'alphafold3').errors, []);
    assert.match(serialize(document, 'opendde').errors.join('\n'), /inline MSA data is unsupported/);
    assert.match(serialize(document, 'protenix').errors.join('\n'), /inline MSA data is unsupported/);
});

test('serializes all sequence types, multiplicity, modifications, and MSA paths', () => {
    const source = {
        name: 'all_entities', modelSeeds: [101], dialect: 'alphafold3', version: 4,
        sequences: [
            { protein: { id: ['A', 'B'], sequence: 'AC', modifications: [{ ptmType: 'MSE', ptmPosition: 1 }], pairedMsaPath: '/paired.a3m' } },
            { dna: { id: 'D', sequence: 'AT', modifications: [{ modType: '6MA', modPosition: 2 }] } },
            { rna: { id: 'R', sequence: 'AU', modifications: [{ modType: '5MC', modPosition: 1 }], unpairedMsaPath: '/rna.a3m' } }
        ]
    };
    const result = serialize(fromAlphaFold3(source), 'opendde');
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.data[0].sequences, [
        { proteinChain: { count: 2, id: ['A', 'B'], sequence: 'AC', modifications: [{ ptmType: 'CCD_MSE', ptmPosition: 1 }], pairedMsaPath: '/paired.a3m' } },
        { dnaSequence: { count: 1, id: ['D'], sequence: 'AT', modifications: [{ modificationType: 'CCD_6MA', basePosition: 2 }] } },
        { rnaSequence: { count: 1, id: ['R'], sequence: 'AU', modifications: [{ modificationType: 'CCD_5MC', basePosition: 1 }], unpairedMsaPath: '/rna.a3m' } }
    ]);
});

test('maps chain-copy covalent bonds and CCD/SMILES ligands', () => {
    const source = {
        name: 'bonds', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [
            { protein: { id: ['A', 'B'], sequence: 'NNST' } },
            { ligand: { id: ['GA', 'GB'], ccdCodes: ['NAG', 'BMA'] } },
            { ligand: { id: 'L', smiles: 'CCO' } }
        ],
        bondedAtomPairs: [[['B', 2, 'ND2'], ['GB', 1, 'C1']]]
    };
    const result = serialize(fromAlphaFold3(source), 'protenix');
    assert.deepEqual(result.errors, []);
    assert.equal(result.data[0].sequences[1].ligand.ligand, 'CCD_NAG_BMA');
    assert.equal(result.data[0].sequences[2].ligand.ligand, 'CCO');
    assert.deepEqual(result.data[0].covalent_bonds[0], {
        entity1: '1', copy1: 2, position1: '2', atom1: 'ND2',
        entity2: '2', copy2: 2, position2: '1', atom2: 'C1'
    });
});

test('normalizes built-in glycan CCD aliases and rejects custom components', () => {
    const builtIn = alphaFoldFixture();
    builtIn.sequences[1].ligand.ccdCodes = ['SIA-2', 'SO4-2', 'PO4-2', 'NH4'];
    builtIn.userCCD = 'data_SIA-2\n#\ndata_SO4-2\n#\ndata_PO4-2\n#\ndata_NH4\n#\n';
    const converted = serialize(fromAlphaFold3(builtIn), 'opendde');
    assert.deepEqual(converted.errors, []);
    assert.equal(converted.data[0].sequences[1].ligand.ligand, 'CCD_SIA_SO4_PO4_NH4');

    builtIn.userCCD = 'data_CUSTOM-1\n#\n_chem_comp.id CUSTOM\n';
    assert.match(serialize(fromAlphaFold3(builtIn), 'protenix').errors.join('\n'), /custom userCCD components: CUSTOM-1/);
});

test('validates template contents and rejects mixed MSA source modes', () => {
    const document = fromAlphaFold3(alphaFoldFixture());
    document.job.entities[0].templates = [{}];
    document.job.entities[0].msa = {
        unpaired: { source: 'path', value: '/data/unpaired.a3m' },
        paired: { source: 'inline', value: '>query\nACDE' }
    };

    const result = serialize(document, 'alphafold3');

    assert.equal(result.data, null);
    assert.match(result.errors.join('\n'), /template 1 requires mmcifPath or mmcif/);
    assert.match(result.errors.join('\n'), /queryIndices must be a non-empty array/);
    assert.match(result.errors.join('\n'), /templateIndices must be a non-empty array/);
    assert.match(result.errors.join('\n'), /paired and unpaired MSA must use the same source type/);
});

test('registers Chai, Boltz, and OpenFold 3 targets with output formats', () => {
    assert.equal(TARGETS.openfold3.outputFormat, 'json');
    assert.equal(TARGETS.chai.outputFormat, 'fasta');
    assert.equal(TARGETS.boltz.outputFormat, 'yaml');
    assert.equal(ADAPTERS.chai.name, 'Chai-1');
    assert.equal(ADAPTERS.boltz.name, 'Boltz');
    assert.equal(ADAPTERS.openfold3.name, 'OpenFold 3');
});

test('serializes OpenFold 3 queries JSON with chains and non-canonical residues', () => {
    const source = {
        name: 'superset_test', modelSeeds: [7], dialect: 'alphafold3', version: 4,
        sequences: [
            { protein: { id: ['A', 'B'], sequence: 'ACDE', modifications: [{ ptmType: 'MSE', ptmPosition: 1 }], pairedMsaPath: '/data/paired.a3m', unpairedMsaPath: '/data/unpaired.a3m' } },
            { ligand: { id: 'G', ccdCodes: ['NAG', 'SO4-2'] } }
        ]
    };
    const result = serialize(fromAlphaFold3(source), 'openfold3');

    assert.deepEqual(result.errors, []);
    const chains = result.data.queries.superset_test.chains;
    assert.equal(chains.length, 2);
    assert.equal(chains[0].molecule_type, 'protein');
    assert.deepEqual(chains[0].chain_ids, ['A', 'B']);
    assert.equal(chains[0].sequence, 'ACDE');
    assert.deepEqual(chains[0].non_canonical_residues, { '1': 'MSE' });
    assert.equal(chains[0].main_msa_file_paths, '/data/unpaired.a3m');
    assert.equal(chains[0].paired_msa_file_paths, '/data/paired.a3m');
    assert.equal(chains[1].molecule_type, 'ligand');
    assert.deepEqual(chains[1].ccd_codes, ['NAG', 'SO4-2']);
});

test('serializes Chai-1 FASTA with headers, modifications, and SMILES ligands', () => {
    const source = {
        name: 'chai', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [
            { protein: { id: 'A', sequence: 'MSETK', modifications: [{ ptmType: 'SEP', ptmPosition: 3 }] } },
            { ligand: { id: 'L', smiles: 'CCO' } }
        ]
    };
    const result = serialize(fromAlphaFold3(source), 'chai');
    assert.deepEqual(result.errors, []);
    assert.equal(result.data, '>protein|name=A\nMS(SEP)TK\n>ligand|name=L\nCCO\n');
});

test('Chai-1 rejects CCD-only ligands and covalent bonds in FASTA', () => {
    const source = {
        name: 'chai', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [
            { protein: { id: 'A', sequence: 'ACDE' } },
            { ligand: { id: 'G', ccdCodes: ['NAG'] } }
        ],
        bondedAtomPairs: [[['A', 1, 'N'], ['G', 1, 'C1']]]
    };
    const result = serialize(fromAlphaFold3(source), 'chai');
    assert.match(result.errors.join('\n'), /ligands must be provided as SMILES/);
    assert.match(result.errors.join('\n'), /does not support AlphaFold bondedAtomPairs/);
});

test('serializes Boltz YAML with modifications, MSA paths, and covalent bonds', () => {
    const source = {
        name: 'boltz', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [
            { protein: { id: ['A', 'B'], sequence: 'MSETK', modifications: [{ ptmType: 'MSE', ptmPosition: 2 }], unpairedMsaPath: '/data/u.a3m' } },
            { ligand: { id: 'L', smiles: 'CCO' } }
        ],
        bondedAtomPairs: [[['B', 2, 'ND2'], ['L', 1, 'C1']]]
    };
    const result = serialize(fromAlphaFold3(source), 'boltz');
    assert.deepEqual(result.errors, []);
    assert.match(result.data, /version: 1/);
    assert.match(result.data, /- protein:/);
    assert.match(result.data, /        - A/);
    assert.match(result.data, /msa: \/data\/u\.a3m/);
    assert.match(result.data, /- position: 2/);
    assert.match(result.data, /ccd: MSE/);
    assert.match(result.data, /- bond:/);
    assert.match(result.data, /atom1: \['B', 2, 'ND2'\]/);
});

test('OpenFold 3 reports native-only template and bond restrictions', () => {
    const source = {
        name: 'of3', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [
            {
                protein: { id: 'A', sequence: 'ACDE', templates: [{ mmcifPath: '/t.cif', queryIndices: [0], templateIndices: [0] }] }
            }
        ],
        bondedAtomPairs: [[['A', 1, 'N'], ['A', 2, 'C']]]
    };
    const document = fromAlphaFold3(source);
    const result = serialize(document, 'openfold3');
    assert.match(result.errors.join('\n'), /not AlphaFold template objects/);
    assert.match(result.errors.join('\n'), /does not support AlphaFold bondedAtomPairs/);
});
