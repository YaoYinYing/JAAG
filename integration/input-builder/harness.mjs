import { mount } from './index.mjs';
import { MAX_DEPENDENCY_BYTES } from '../../shared/input-dependencies.mjs';

const $ = id => document.getElementById(id);
let builder;
let unsubscribe;
let owner = 'empty';
let saved = null;
let bound = null;
let bindingEpoch = 0;
const selectedFiles = new Map();

function status(message) { $('status').textContent = message; }
function renderOwnership() {
    $('ownership').textContent = `Input role: ${owner}${bound ? ` (${bound.name})` : ''}`;
    $('output').textContent = owner === 'builder' && bound ? new TextDecoder().decode(bound.bytes) : '';
}
function changed() {
    bindingEpoch++;
    if (owner === 'builder') { owner = 'empty'; bound = null; renderOwnership(); }
    status('Editor changed. Generate again to bind updated output.');
}
function setEnabled(value) {
    for (const id of ['slots', 'generate']) $(id).disabled = !value;
    $('clone').disabled = !value || !saved;
}
async function open() {
    bindingEpoch++;
    unsubscribe?.();
    builder?.destroy();
    builder = null;
    saved = null;
    selectedFiles.clear();
    $('attachments').replaceChildren();
    if (owner === 'builder') { owner = 'empty'; bound = null; renderOwnership(); }
    setEnabled(false);
    builder = await mount($('builder'), { target: $('target').value });
    unsubscribe = builder.subscribe(changed);
    setEnabled(true);
    status('Workbench ready.');
}
async function showSlots() {
    const slots = await builder.listDependencies();
    if (selectedFiles.size) { selectedFiles.clear(); changed(); }
    $('attachments').replaceChildren(...slots.map(slot => {
        const wrapper = document.createElement('div');
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'file';
        input.addEventListener('change', () => {
            if (input.files[0]) selectedFiles.set(slot.id, input.files[0]);
            else selectedFiles.delete(slot.id);
            changed();
        });
        label.textContent = `${slot.kind} (${slot.slot.join(' / ')})`;
        label.append(input);
        wrapper.append(label);
        return wrapper;
    }));
    status(slots.length ? 'Choose a file for each listed dependency.' : 'No supporting files are needed.');
}
async function resolveSlot(slot) {
    const file = selectedFiles.get(slot.id);
    if (!file) return null;
    if (file.size > MAX_DEPENDENCY_BYTES) throw new Error('Supporting file exceeds the 20 MiB limit.');
    return { name: file.name, mime: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
}
async function generate() {
    if (owner === 'external') throw new Error('Clear the independent upload before binding generated input.');
    const epoch = ++bindingEpoch;
    const result = await builder.materialize(resolveSlot);
    if (epoch !== bindingEpoch || owner === 'external') throw new Error('Input changed before the generated file could be bound.');
    saved = { snapshot: result.snapshot, files: new Map(result.dependencies.map(file => [file.id, file])) };
    bound = result.output;
    owner = 'builder';
    renderOwnership();
    setEnabled(true);
    status(`Bound ${bound.name} at revision ${result.revision}; snapshot and supporting bytes are held in memory.`);
}
async function clone() {
    if (!saved) throw new Error('Generate an input first.');
    bindingEpoch++;
    await builder.restore(saved.snapshot, item => saved.files.get(item.id)?.bytes);
    selectedFiles.clear();
    for (const [id, file] of saved.files) selectedFiles.set(id, new File([file.bytes], file.name, { type: file.mime }));
    $('attachments').replaceChildren();
    status('Clone restored. Edit it and generate again to bind a new input.');
}
for (const [id, action] of [['mount', open], ['slots', showSlots], ['generate', generate], ['clone', clone]]) {
    $(id).addEventListener('click', async () => {
        const button = $(id);
        button.disabled = true;
        try { await action(); } catch (error) { status(error.message); }
        finally { if (id === 'mount') button.disabled = false; else setEnabled(!!builder); }
    });
}
$('external').addEventListener('change', () => {
    bindingEpoch++;
    bound = $('external').files[0] || null;
    owner = bound ? 'external' : 'empty';
    renderOwnership();
});
$('clear').addEventListener('click', () => {
    bindingEpoch++;
    $('external').value = '';
    owner = 'empty'; bound = null; renderOwnership();
});
