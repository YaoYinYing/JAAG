import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { captureInputDependencies, listInputDependencySlots, resolveInputDependencies } from '../shared/input-dependencies.mjs';
import { serialize } from '../shared/jaag-schema.mjs';

function documentWithFiles() {
    return {
        schema: 'jaag-superset', schemaVersion: 1, target: 'alphafold3', options: { alphafoldVersion: 4 },
        job: { name: 'Synthetic', seeds: [7], bonds: [], entities: [
            { key: 'protein-key', type: 'protein', chainIds: ['A'], sequence: 'MNNST',
                msa: { unpaired: { source: 'path', value: '/private/msa.a3m' }, paired: { source: 'path', value: 'https://example.invalid/private.a3m' } },
                templates: [{ mmcifPath: '/private/model.cif', queryIndices: [0], templateIndices: [0] }],
                templatesPath: '/private/templates.hhr' },
            { key: 'ligand-key', type: 'ligand', chainIds: ['L'], ligand: { source: 'file', path: '/private/ligand.sdf' } }
        ], customComponents: { path: '/private/ccd.cif' } }
    };
}

const encoder = new TextEncoder();

test('dependency capture replaces private paths with safe stable slots and verifies bytes', async () => {
    const source = documentWithFiles();
    const original = JSON.stringify(source);
    const resolverCalls = [];
    const captured = await captureInputDependencies(source, async slot => {
        resolverCalls.push(slot);
        return { name: '../../same name.a3m', mime: 'text/plain', bytes: encoder.encode(slot.kind) };
    });
    assert.equal(captured.dependencies.length, 6);
    assert.equal(JSON.stringify(source), original);
    assert.doesNotMatch(JSON.stringify(captured.document), /private|https:/);
    assert.equal(new Set(captured.files.map(file => file.path)).size, 6);
    assert.ok(captured.files.every(file => /^dependencies\/dep-[0-9a-f]{24}\/same_name\.a3m$/.test(file.path)));
    assert.ok(resolverCalls.every(slot => Object.keys(slot).sort().join(',') === 'id,kind,slot'));
    assert.doesNotMatch(JSON.stringify(resolverCalls), /private|https:/);
    assert.deepEqual(await listInputDependencySlots(source), resolverCalls);
    const saved = new Map(captured.files.map(file => [file.id, file.bytes]));
    const restored = await resolveInputDependencies(captured.document, captured.dependencies, async item => saved.get(item.id));
    assert.deepEqual(restored.document, captured.document);
    assert.equal(restored.files.length, 6);
    const reordered = documentWithFiles();
    reordered.job.entities.reverse();
    const second = await captureInputDependencies(reordered, async slot => ({ name: 'same.a3m', bytes: encoder.encode(slot.kind) }));
    assert.deepEqual(new Set(second.dependencies.map(item => item.id)), new Set(captured.dependencies.map(item => item.id)));
});

test('dependency resolution rejects missing, altered, mismatched and unsafe files', async () => {
    const captured = await captureInputDependencies(documentWithFiles(), async slot => ({ name: 'input.cif', bytes: encoder.encode(slot.kind) }));
    const saved = new Map(captured.files.map(file => [file.id, file.bytes]));
    await assert.rejects(resolveInputDependencies(captured.document, captured.dependencies.slice(1), async item => saved.get(item.id)), /manifest/);
    await assert.rejects(resolveInputDependencies(captured.document, captured.dependencies, async () => encoder.encode('wrong')), /digest/);
    const altered = structuredClone(captured.document);
    altered.job.entities[0].msa.unpaired.value = '../escape.a3m';
    await assert.rejects(resolveInputDependencies(altered, captured.dependencies, async item => saved.get(item.id)), /path mismatch/);
    const badMetadata = structuredClone(captured.dependencies);
    badMetadata[0].name = '../evil';
    await assert.rejects(resolveInputDependencies(captured.document, badMetadata, async item => saved.get(item.id)), /Invalid metadata/);
    await assert.rejects(captureInputDependencies(documentWithFiles(), async () => null), /Missing file dependency/);
});

test('resolved runner paths are the paths emitted by the target serializer', async () => {
    const source = documentWithFiles();
    source.target = 'opendde';
    delete source.job.customComponents;
    delete source.job.entities[0].templates;
    delete source.job.entities[0].templatesPath;
    const captured = await captureInputDependencies(source, async slot => ({ name: `${slot.kind}.dat`, bytes: encoder.encode(slot.kind) }));
    const bytes = new Map(captured.files.map(file => [file.id, file.bytes]));
    const resolved = await resolveInputDependencies(captured.document, captured.dependencies, async item => bytes.get(item.id));
    const conversion = serialize(resolved.document, 'opendde');
    assert.equal(conversion.errors.length, 0);
    const output = JSON.stringify(conversion.data);
    for (const file of resolved.files) assert.ok(output.includes(file.path));
    assert.doesNotMatch(output, /private|https:/);
});

test('resolver cannot change the recorded digest while verification is in flight', async () => {
    const captured = await captureInputDependencies(documentWithFiles(), async () => ({ name: 'input.cif', bytes: encoder.encode('original') }));
    const other = await captureInputDependencies(documentWithFiles(), async () => ({ name: 'input.cif', bytes: encoder.encode('changed') }));
    await assert.rejects(resolveInputDependencies(captured.document, captured.dependencies, async item => {
        captured.dependencies.find(entry => entry.id === item.id).sha256 = other.dependencies.find(entry => entry.id === item.id).sha256;
        return encoder.encode('changed');
    }), /digest/);
    const crossRealmBytes = vm.runInNewContext('new Uint8Array([1, 2, 3])');
    const crossRealm = await captureInputDependencies(documentWithFiles(), async () => ({ name: 'input.cif', bytes: crossRealmBytes }));
    assert.equal(crossRealm.files[0].size, 3);
});
