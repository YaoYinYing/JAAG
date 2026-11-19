// Host-supplied file bytes for the existing jaag-superset document. No network access.
import { validateSuperset } from './jaag-schema.mjs';

export const MAX_DEPENDENCY_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_DEPENDENCY_BYTES = 100 * 1024 * 1024;
export const MAX_DEPENDENCIES = 256;
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

function cloneDocument(document) {
    const serialized = JSON.stringify(document);
    if (typeof serialized !== 'string' || serialized.length > MAX_DOCUMENT_BYTES
        || new TextEncoder().encode(serialized).byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error('Input document is too large or not serializable');
    }
    const copy = JSON.parse(serialized);
    const validation = validateSuperset(copy);
    if (!validation.valid) throw new Error(`Invalid input document: ${validation.errors.join('; ')}`);
    return copy;
}

async function sha256(bytes) {
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable');
    const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, '0')).join('');
}

function safeFilename(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '');
    if (!base || base === '.' || base === '..') return 'attachment.bin';
    if (base.length <= 96) return base;
    const extension = base.match(/\.[A-Za-z0-9]{1,12}$/)?.[0] || '';
    return base.slice(0, 96 - extension.length) + extension;
}

async function slotsFor(document) {
    const candidates = [];
    const add = (owner, field, key, kind) => {
        if (typeof owner?.[field] === 'string' && owner[field].trim()) candidates.push({ owner, field, key, kind });
    };
    for (const entity of document.job.entities) {
        const key = entity.key;
        if (entity.ligand?.source === 'file') add(entity.ligand, 'path', [key, 'ligand'], 'ligand');
        for (const kind of ['unpaired', 'paired']) {
            if (entity.msa?.[kind]?.source === 'path') add(entity.msa[kind], 'value', [key, 'msa', kind], `${kind}-msa`);
        }
        add(entity, 'templatesPath', [key, 'templatesPath'], 'template');
        for (const [index, template] of (entity.templates || []).entries()) {
            add(template, 'mmcifPath', [key, 'template', index], 'template');
        }
    }
    add(document.job.customComponents, 'path', ['customComponents'], 'custom-ccd');
    if (candidates.length > MAX_DEPENDENCIES) throw new Error('Too many file dependencies');
    const ids = new Set();
    for (const slot of candidates) {
        slot.id = `dep-${(await sha256(new TextEncoder().encode(JSON.stringify(slot.key)))).slice(0, 24)}`;
        if (ids.has(slot.id)) throw new Error('Duplicate dependency slot');
        ids.add(slot.id);
    }
    return candidates;
}

function checkedBytes(value) {
    if (!ArrayBuffer.isView(value) || Object.prototype.toString.call(value) !== '[object Uint8Array]') {
        throw new Error('Dependency resolver must return Uint8Array bytes');
    }
    if (value.byteLength > MAX_DEPENDENCY_BYTES) throw new Error('File dependency is too large');
    return new Uint8Array(value);
}

function mimeType(value) {
    return typeof value === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(value) && value.length <= 100
        ? value : 'application/octet-stream';
}

/** Describe required slots without exposing their current path values. */
export async function listInputDependencySlots(document) {
    const slots = await slotsFor(cloneDocument(document));
    return slots.map(slot => ({ id: slot.id, kind: slot.kind, slot: [...slot.key] }));
}

/** Capture a valid neutral document and replace path references with safe, host-bound slots. */
export async function captureInputDependencies(document, resolve) {
    if (typeof resolve !== 'function') throw new TypeError('A dependency resolver is required');
    const copy = cloneDocument(document);
    const slots = await slotsFor(copy);
    const dependencies = [];
    const files = [];
    let total = 0;
    for (const slot of slots) {
        // The resolver receives no path or URL; the host supplies authorized bytes explicitly.
        const supplied = await resolve({ id: slot.id, kind: slot.kind, slot: [...slot.key] });
        if (!supplied) throw new Error(`Missing file dependency ${slot.id}`);
        const bytes = checkedBytes(supplied.bytes);
        total += bytes.byteLength;
        if (total > MAX_TOTAL_DEPENDENCY_BYTES) throw new Error('File dependencies exceed the total size limit');
        const name = safeFilename(supplied.name);
        const path = `dependencies/${slot.id}/${name}`;
        const item = { id: slot.id, kind: slot.kind, slot: [...slot.key], name, size: bytes.byteLength,
            sha256: await sha256(bytes), mime: mimeType(supplied.mime) };
        slot.owner[slot.field] = path;
        dependencies.push(item);
        files.push({ ...item, path, bytes });
    }
    return { document: copy, dependencies, files };
}

/** Verify every declared dependency before returning bytes for target materialization. */
export async function resolveInputDependencies(document, dependencies, resolve) {
    if (typeof resolve !== 'function' || !Array.isArray(dependencies)) throw new TypeError('Dependencies and resolver are required');
    if (dependencies.length > MAX_DEPENDENCIES) throw new Error('Too many file dependencies');
    const serializedManifest = JSON.stringify(dependencies);
    if (serializedManifest.length > 1024 * 1024) throw new Error('Dependency manifest is too large');
    const manifestCopy = JSON.parse(serializedManifest);
    const copy = cloneDocument(document);
    const slots = await slotsFor(copy);
    if (manifestCopy.length !== slots.length) throw new Error('Dependency manifest does not match the document');
    const manifest = new Map();
    for (const item of manifestCopy) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || manifest.has(item.id)
            || Object.keys(item).some(key => !['id', 'kind', 'slot', 'name', 'size', 'sha256', 'mime'].includes(key))) {
            throw new Error('Invalid dependency manifest');
        }
        manifest.set(item.id, item);
    }
    const files = [];
    let total = 0;
    for (const slot of slots) {
        const item = manifest.get(slot.id);
        if (!item || item.kind !== slot.kind || JSON.stringify(item.slot) !== JSON.stringify(slot.key)
            || typeof item.name !== 'string' || safeFilename(item.name) !== item.name
            || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > MAX_DEPENDENCY_BYTES
            || !/^[0-9a-f]{64}$/.test(item.sha256) || mimeType(item.mime) !== item.mime) {
            throw new Error(`Invalid metadata for dependency ${slot.id}`);
        }
        const path = `dependencies/${slot.id}/${item.name}`;
        if (slot.owner[slot.field] !== path) throw new Error(`Dependency path mismatch for ${slot.id}`);
        const bytes = checkedBytes(await resolve({ ...item }));
        total += bytes.byteLength;
        if (total > MAX_TOTAL_DEPENDENCY_BYTES) throw new Error('File dependencies exceed the total size limit');
        if (bytes.byteLength !== item.size || await sha256(bytes) !== item.sha256) {
            throw new Error(`File dependency ${slot.id} does not match its recorded digest`);
        }
        files.push({ id: item.id, kind: item.kind, slot: [...slot.key], name: item.name, size: item.size,
            sha256: item.sha256, mime: item.mime, path, bytes });
    }
    return { document: copy, files };
}
