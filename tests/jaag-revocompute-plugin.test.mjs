import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        getAttribute() { return null; }
    };
    return node;
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
