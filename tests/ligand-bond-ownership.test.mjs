import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function setup(document, app, extras = {}) {
    const context = { window: { app }, app, document, console, ...extras };
    vm.runInNewContext(readFileSync(new URL('../js/sequences.js', import.meta.url), 'utf8'), context);
    return context;
}

test('generated glycan bonds stay on the ligand and do not alter manual bonds', async () => {
    const app = { sequences: [], bondedAtomPairs: [{ id: 'manual', data: [['A', 1, 'CA'], ['L', 1, 'C1']] }] };
    const fields = { seq_1_ligandType: { value: 'glycan' }, seq_1_glycoCT: { value: 'synthetic' } };
    const context = setup({ getElementById: id => fields[id] || null }, app, {
        convertGlycoCTToEnhancedLigand: async () => ({ ligand: { ligand: { ccdCodes: ['NAG', 'MAN'] } }, bondedAtomPairs: [[['L', 1, 'O4'], ['L', 2, 'C1']]] })
    });
    context.validateGlycoCTStructure = () => ({ valid: true });
    context.displayGlycoCTValidationErrors = () => {};
    const ligand = { id: ['L1', 'L2'] };
    const generated = await context.addLigandTypeData('seq_1', ligand);
    assert.equal(generated.length, 2);
    assert.deepEqual(Array.from(generated, bond => bond[0][0]), ['L1', 'L2']);
    assert.equal(app.bondedAtomPairs.length, 1);
    assert.equal(app.bondedAtomPairs[0].id, 'manual');
});

test('late ligand calculation cannot overwrite a newer edit or a removed entity', async () => {
    const sequence = { id: 'seq_1', type: 'ligand', data: {} };
    const app = { sequences: [sequence], bondedAtomPairs: [] };
    const document = { getElementById: id => id === 'seq_1_id' ? { value: 'L' } : null };
    const context = setup(document, app);
    context.updateChainIdBadge = () => {};
    context.refreshBondedAtomPairDropdowns = () => {};
    const pending = [];
    context.buildLigandData = () => new Promise(resolve => pending.push(resolve));
    const old = context.updateSequenceData('seq_1', 'ligand');
    const fresh = context.updateSequenceData('seq_1', 'ligand');
    pending[1]({ data: { ligand: { id: 'new' } }, bonds: [] });
    await fresh;
    pending[0]({ data: { ligand: { id: 'old' } }, bonds: ['old'] });
    await old;
    assert.equal(sequence.data.ligand.id, 'new');
    assert.equal(sequence.bondedAtomPairs.length, 0);
    const removed = context.updateSequenceData('seq_1', 'ligand');
    app.sequences = [];
    pending[2]({ data: { ligand: { id: 'removed' } }, bonds: [] });
    await removed;
    assert.equal(sequence.data.ligand.id, 'new');
});
