import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Number of entity-type options rendered by the builder's per-row type selector.
const ENTITY_TYPE_COUNT = 4;

// Contract test for the standalone REvoCompute plugin bundle. It mirrors the
// harness REvoCompute uses in tests/js/test_contracts.js: the bundle is loaded
// with `new Function("global", "window", "document", code)` against a minimal
// DOM, then the registered plugin is mounted and exercised.

function fakeNode(tag) {
    const node = {
        tag: tag || 'div',
        className: '',
        textContent: '',
        value: '',
        type: '',
        placeholder: '',
        selected: false,
        hidden: false,
        style: {},
        children: [],
        parentNode: null,
        _listeners: {},
        appendChild(child) {
            child.parentNode = node;
            node.children.push(child);
            return child;
        },
        remove() {
            if (node.parentNode) {
                node.parentNode.children = node.parentNode.children.filter(child => child !== node);
            }
        },
        addEventListener(type, fn) {
            if (!node._listeners[type]) node._listeners[type] = [];
            node._listeners[type].push(fn);
        },
        removeEventListener(type, fn) {
            if (node._listeners[type]) node._listeners[type] = node._listeners[type].filter(listener => listener !== fn);
        },
        dispatchEvent(type) {
            (node._listeners[type] || []).forEach(fn => fn({ type }));
        },
        setAttribute() {},
        getAttribute() { return null; }
    };
    return node;
}

function walk(node, predicate) {
    if (predicate(node)) return node;
    for (const child of node.children || []) {
        const found = walk(child, predicate);
        if (found) return found;
    }
    return null;
}

function loadPluginBundle() {
    const code = readFileSync(resolve('dist/jaag-builder.revo.js'), 'utf8');

    const documentShim = {
        createElement(tag) { return fakeNode(tag); },
        createTextNode(text) {
            const node = fakeNode('#text');
            node.textContent = text;
            return node;
        }
    };

    const registry = { definitions: {}, register(def) { this.definitions[def.id] = def; } };
    const contextState = {
        JAAGCore: null,
        REvoComputeInputWorkspace: { registry },
        document: documentShim,
        File
    };

    const fn = new Function('global', 'window', 'document', code);
    fn(contextState, contextState, contextState.document);

    return { state: contextState, registry };
}

test('plugin bundle attaches the JAAG core and registers jaag-builder', () => {
    const { state, registry } = loadPluginBundle();
    assert.ok(state.JAAGCore, 'global.JAAGCore must be attached by the bundle');
    assert.equal(typeof state.JAAGCore.build, 'function');
    assert.ok(registry.definitions['jaag-builder'], 'jaag-builder plugin must be registered');
});

test('jaag-builder mounts, seeds a valid entity, and synthesizes an AF3 JSON file', async () => {
    const { state, registry } = loadPluginBundle();
    const definition = registry.definitions['jaag-builder'];

    const target = fakeNode('div');
    const context = {
        changedCalls: 0,
        generatedFile: null,
        setGeneratedFile(file) { context.generatedFile = file; },
        generatedFile() { return context.generatedFile; },
        form: { name: 'alphafold3', display_name: 'AlphaFold 3', params: [] },
        changed() { context.changedCalls += 1; }
    };

    const instance = definition.mount(target, { options: { target: 'alphafold3' } }, context);

    for (const method of ['readValue', 'validate', 'summarize', 'refresh', 'destroy']) {
        assert.equal(typeof instance[method], 'function', `plugin must expose ${method}`);
    }

    // Mount seeds one protein entity and immediately builds a valid file.
    assert.ok(context.generatedFile, 'mount must synthesize a generated input file');
    assert.equal(context.generatedFile.name, 'jaag-alphafold3.json');
    assert.ok(context.changedCalls > 0, 'refresh must notify the workspace on change');

    const generated = JSON.parse((await context.generatedFile.text()).trim());
    assert.equal(generated.name, 'Untitled_Job');
    assert.equal(generated.dialect, 'alphafold3');
    assert.equal(generated.sequences.length, 1);
    assert.equal(generated.sequences[0].protein.sequence, 'ACDEFGHIK');

    assert.deepEqual(instance.validate(), [], 'seeded model must validate');
    const summary = instance.summarize();
    assert.equal(summary.label, 'Structure input');
    assert.match(summary.value, /1 entity/);

    const value = instance.readValue();
    assert.equal(value.schema, 'jaag-superset');
    assert.equal(value.target, 'alphafold3');
    assert.equal(value.model.entities.length, 1);

    instance.destroy();
    assert.equal(context.generatedFile, null, 'destroy must clear the generated file');
});

test('jaag-builder targets opendde and synthesizes a server-style job list', async () => {
    const { state, registry } = loadPluginBundle();
    const definition = registry.definitions['jaag-builder'];

    const target = fakeNode('div');
    const context = {
        generatedFile: null,
        setGeneratedFile(file) { context.generatedFile = file; },
        generatedFile() { return context.generatedFile; },
        form: { name: 'opendde', display_name: 'OpenDDE', params: [] },
        changed() {}
    };

    definition.mount(target, { options: { target: 'opendde' } }, context);

    assert.equal(context.generatedFile.name, 'jaag-opendde.json');
    const generated = JSON.parse((await context.generatedFile.text()).trim());
    assert.ok(Array.isArray(generated), 'OpenDDE payload must be a job list');
    assert.equal(generated[0].sequences[0].proteinChain.sequence, 'ACDEFGHIK');
});

test('single-target runners expose only their configured dialect', () => {
    const { state, registry } = loadPluginBundle();
    const definition = registry.definitions['jaag-builder'];

    const target = fakeNode('div');
    const context = { setGeneratedFile() {}, generatedFile() { return null; }, form: { name: 'alphafold3', params: [] }, changed() {} };
    definition.mount(target, { options: { target: 'alphafold3' } }, context);

    // The target selector is the very first node appended to the mount target.
    const targetSelect = target.children[0];
    assert.equal(targetSelect.tag, 'select');
    assert.equal(targetSelect.children.length, 1, 'only one dialect option exposed');
    assert.equal(targetSelect.value, 'alphafold3');
});

test('explicit multi-target list exposes the requested dialects', () => {
    const { state, registry } = loadPluginBundle();
    const definition = registry.definitions['jaag-builder'];

    const target = fakeNode('div');
    const context = { setGeneratedFile() {}, generatedFile() { return null; }, form: { name: 'alphafold3', params: [] }, changed() {} };
    definition.mount(target, { options: { targets: ['alphafold3', 'opendde'] } }, context);

    const targetSelect = target.children[0];
    assert.equal(targetSelect.children.length, 2, 'both requested dialects exposed');
});

test('malformed covalent bond lines are reported instead of silently dropped', () => {
    const { state, registry } = loadPluginBundle();
    const definition = registry.definitions['jaag-builder'];

    const target = fakeNode('div');
    const context = { setGeneratedFile(file) { context.generatedFile = file; }, generatedFile() { return null; }, form: { name: 'alphafold3', params: [] }, changed() {} };
    const instance = definition.mount(target, { options: { target: 'alphafold3' } }, context);
    instance.destroy(); // clear seeded generatedFile

    const bondsArea = walk(target, node => node.tag === 'textarea' && node.placeholder === 'one bond per line: A:2:ND2 G:1:C1');
    assert.ok(bondsArea, 'bonds textarea is present');
    bondsArea.value = 'A:1:N not-an-endpoint';
    const errors = instance.validate();
    assert.ok(errors.some(message => /Invalid covalent bond/.test(message)), 'malformed bond must be rejected');
    assert.equal(context.generatedFile, null, 'invalid builder must not synthesize a file');
});

test('switching an entity row to ligand reveals the ligand input and runs validation', () => {
    const { state, registry } = loadPluginBundle();
    const definition = registry.definitions['jaag-builder'];

    const target = fakeNode('div');
    const context = { setGeneratedFile() {}, generatedFile() { return null; }, form: { name: 'alphafold3', params: [] }, changed() {} };
    definition.mount(target, { options: { target: 'alphafold3' } }, context);

    // The entity type selector has four options (protein/dna/rna/ligand), while
    // the target selector has exactly one option in single-target mode.
    const typeSelect = walk(target, node => node.tag === 'select' && node.children.length === ENTITY_TYPE_COUNT);
    assert.ok(typeSelect, 'entity type selector is present');
    const ligandInput = walk(target, node => node.tag === 'input' && node.placeholder === 'CCD codes (NAG,FUC) or SMILES');
    const sequenceArea = walk(target, node => node.tag === 'textarea' && node.placeholder === 'sequence');
    assert.ok(ligandInput && sequenceArea, 'entity fields are present');

    typeSelect.value = 'ligand';
    typeSelect.dispatchEvent('change');

    assert.equal(ligandInput.style.display, '', 'ligand input must be visible for ligand rows');
    assert.equal(sequenceArea.style.display, 'none', 'sequence area must hide for ligand rows');
});
