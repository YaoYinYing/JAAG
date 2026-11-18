import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('incomplete manual glycosylation cannot be silently omitted', async () => {
    function Generator() {}
    const card = { id: 'glyco_seq_1_1' };
    const fields = {
        jobName: { value: 'Test' }, version: { value: '4' }, modelSeedsMultiple: { value: '1' },
        seq_1_glycosylationSites: { querySelectorAll: () => [card] },
        glyco_seq_1_1_position: { value: '2' }, glyco_seq_1_1_residueType: { value: 'N' },
        glyco_seq_1_1_atom: { value: 'ND2' }, glyco_seq_1_1_chainId: { value: 'G' },
        glyco_seq_1_1_glycan: { value: '' }
    };
    const document = { getElementById: id => fields[id] || null };
    const context = { AlphaFold3Generator: Generator, document, window: {}, console };
    vm.runInNewContext(readFileSync(new URL('../js/json-generator.js', import.meta.url), 'utf8'), context);
    const app = new Generator();
    app.sequences = [{ id: 'seq_1', type: 'protein', data: {} }];
    await assert.rejects(app.buildAlphaFold3JSON(), /Complete or remove the glycosylation site/);
});

test('glycan conversion failures propagate to the caller', async () => {
    const context = { window: { app: {} }, document: {}, console,
        convertGlycoCTToEnhancedLigand: async () => { throw new Error('conversion failed'); } };
    vm.runInNewContext(readFileSync(new URL('../js/sequences.js', import.meta.url), 'utf8'), context);
    context.collectGlycosylationSites = () => [{ position: 2, residueType: 'N', atom: 'ND2', chainId: 'G', glycoCT: 'bad' }];
    context.collectSequonSites = () => [];
    await assert.rejects(context.processGlycosylationSites('seq_1', 'A'), /Glycan at position 2: conversion failed/);
});

test('job generation reports a failed glycan conversion instead of exporting a partial job', async () => {
    function Generator() {}
    const fields = { jobName: { value: 'Test' }, version: { value: '4' }, modelSeedsMultiple: { value: '1' } };
    const context = {
        AlphaFold3Generator: Generator,
        document: { getElementById: id => fields[id] || null },
        window: {}, console,
        processGlycosylationSites: async () => { throw new Error('conversion failed'); }
    };
    vm.runInNewContext(readFileSync(new URL('../js/json-generator.js', import.meta.url), 'utf8'), context);
    const app = new Generator();
    app.sequences = [{ id: 'seq_1', type: 'protein', data: {
        protein: { id: 'A', sequence: 'MNNSTAA' }, _glycosylationSites: [{}], _proteinSequenceId: 'seq_1'
    } }];
    app.validateSequenceData = data => ({ protein: data.protein });
    await assert.rejects(app.buildAlphaFold3JSON(), /Glycosylation on chain A: conversion failed/);
});
