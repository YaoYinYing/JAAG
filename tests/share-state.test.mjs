import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('shared-input hydration preserves explicit multimer IDs and commits bonds', async () => {
    const elements = new Map();
    const element = id => {
        if (!elements.has(id)) elements.set(id, { id, value: '', innerHTML: '', textContent: '' });
        return elements.get(id);
    };
    ['jobName', 'modelSeedsMultiple', 'version', 'outputTarget', 'sequencesContainer', 'bondedAtomPairsContainer', 'userCCDPath']
        .forEach(element);

    const inputDocument = {
        schema: 'jaag-superset', schemaVersion: 1, target: 'alphafold3',
        options: { alphafoldVersion: 4 },
        job: {
            name: 'restore', seeds: [1],
            entities: [
                { key: 'p', type: 'protein', chainIds: ['A', 'B'], sequence: 'AC' },
                { key: 'l', type: 'ligand', chainIds: ['G'], ligand: { source: 'ccd', ccdCodes: ['NAG'] } }
            ],
            bonds: [{ left: { chainId: 'A', position: 1, atom: 'CA' }, right: { chainId: 'G', position: 1, atom: 'C1' } }]
        }
    };
    let readyListener;
    const window = {
        location: { href: 'https://jaag.test/?p=payload' },
        app: {
            sequences: [], bondedAtomPairs: [], sequenceCounter: 0, bondCounter: 0,
            updateOutputTargetUI() {}, async generateJSON() {}, showSuccess() {}, showError() {}
        },
        JAAGCoreReady: Promise.resolve(),
        JAAGCore: { validateSuperset: () => ({ valid: true, errors: [] }) },
        JAAGShare: {
            decodeSharePayload: async () => {
                assert.equal(window.app.isRestoringSharedInput, true);
                return inputDocument;
            }
        },
        pako: { inflate: value => value },
        addEventListener: (name, listener) => { if (name === 'DOMContentLoaded') readyListener = listener; }
    };
    window.addSequence = type => {
        const id = `seq_${++window.app.sequenceCounter}`;
        window.app.sequences.push({ id, type });
        [`${id}_id`, `${id}_count`, `${id}_sequence`, `${id}_description`, `${id}_chainList`, `${id}_ligandType`, `${id}_ccdCodes`, `${id}_smiles`]
            .forEach(element);
    };
    window.updateMultimerChains = id => {
        window.app.sequences.find(sequence => sequence.id === id).multimerChainIds = ['AA', 'AB'];
    };
    window.updateLigandMultimer = () => {};
    window.toggleLigandInputs = () => {};
    window.updateSequenceData = async () => {};
    window.addBondedAtomPair = () => {
        const id = `bond_${++window.app.bondCounter}`;
        window.app.bondedAtomPairs.push({ id, data: {} });
        [`${id}_chain1`, `${id}_res1`, `${id}_atom1`, `${id}_chain2`, `${id}_res2`, `${id}_atom2`].forEach(element);
    };
    window.updateBondedAtomPair = id => {
        window.app.bondedAtomPairs.find(bond => bond.id === id).data = [
            [element(`${id}_chain1`).value, Number(element(`${id}_res1`).value), element(`${id}_atom1`).value],
            [element(`${id}_chain2`).value, Number(element(`${id}_res2`).value), element(`${id}_atom2`).value]
        ];
    };

    const context = {
        window,
        document: { getElementById: id => element(id) },
        URL,
        setTimeout,
        console
    };
    Object.assign(context, window);
    vm.runInNewContext(readFileSync(new URL('../js/share-state.js', import.meta.url), 'utf8'), context);
    await readyListener();

    assert.deepEqual(Array.from(window.app.sequences[0].multimerChainIds), ['A', 'B']);
    assert.equal(element('seq_1_chainList').textContent, 'A, B');
    assert.deepEqual(window.app.bondedAtomPairs[0].data, [['A', 1, 'CA'], ['G', 1, 'C1']]);
    assert.equal(window.app.isRestoringSharedInput, false);
});
