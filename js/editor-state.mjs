// Workbench-side authoring capture. Hosts must restore into a fresh isolated editor.
import { captureInputDependencies, listInputDependencySlots, resolveInputDependencies, MAX_DOCUMENT_BYTES } from '../shared/input-dependencies.mjs';

const BUILDER = 'bionuta';
const VERSION = 2;
const MAX_SITES = 1000;
const MAX_TEXT = MAX_DOCUMENT_BYTES;
const fields = ['position', 'residueType', 'atom', 'customAtom', 'chainId', 'glycan', 'description'];

function read(id) { return document.getElementById(id)?.value ?? ''; }
function write(id, value) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Editor control unavailable: ${id}`);
    element.value = String(value);
}
function cloneBounded(value) {
    const json = JSON.stringify(value);
    if (typeof json !== 'string' || json.length > MAX_DOCUMENT_BYTES || new TextEncoder().encode(json).byteLength > MAX_DOCUMENT_BYTES) {
        throw new Error('Snapshot is too large or not serializable');
    }
    return JSON.parse(json);
}
function exactKeys(value, keys, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label}`);
}
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return value;
}
function equivalent(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }
function captureCustomComponents(app, inputDocument) {
    const path = inputDocument.job.customComponents?.path;
    const collect = source => Object.entries(source || {}).map(([id, data]) => {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Invalid custom CCD identifier');
        exactKeys(data, ['userCCD', 'userCCDPath', 'source', 'originalCCD'], 'custom CCD');
        if (!!data.userCCD === !!data.userCCDPath) throw new Error('Custom CCD must have exactly one source');
        if (data.userCCDPath && data.userCCDPath !== path) throw new Error('Multiple custom CCD paths cannot be represented');
        const entry = { id, kind: data.userCCD ? 'inline' : 'path', inline: data.userCCD || '', source: data.source || '', originalCCD: data.originalCCD || '' };
        for (const value of Object.values(entry)) if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error('Invalid custom CCD data');
        return entry;
    });
    const pathField = read('userCCDPath');
    if (pathField && pathField !== path) throw new Error('Multiple custom CCD paths cannot be represented');
    return { entries: collect(app.userCCDs), glycanEntries: collect(app.glycanUserCCDs), pathField: !!pathField,
        draftId: read('userCCDId'), draftInline: read('userCCDInput'),
        draftMode: document.getElementById('inlineUserCCD')?.checked ? 'inline' : 'file' };
}
function validateCustomComponents(value, document) {
    exactKeys(value, ['entries', 'glycanEntries', 'pathField', 'draftId', 'draftInline', 'draftMode'], 'custom CCD authoring');
    if (!Array.isArray(value.entries) || !Array.isArray(value.glycanEntries) || typeof value.pathField !== 'boolean'
        || value.entries.length + value.glycanEntries.length > 1000 || !['inline', 'file'].includes(value.draftMode)
        || typeof value.draftId !== 'string' || value.draftId.length > MAX_TEXT
        || typeof value.draftInline !== 'string' || value.draftInline.length > MAX_TEXT) throw new Error('Invalid custom CCD authoring');
    for (const list of [value.entries, value.glycanEntries]) {
        const ids = new Set();
        for (const entry of list) {
            exactKeys(entry, ['id', 'kind', 'inline', 'source', 'originalCCD'], 'custom CCD entry');
            if (typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(entry.id)
                || ['__proto__', 'constructor', 'prototype'].includes(entry.id) || ids.has(entry.id)
                || !['inline', 'path'].includes(entry.kind)) throw new Error('Invalid custom CCD entry');
            ids.add(entry.id);
            for (const key of ['inline', 'source', 'originalCCD']) if (typeof entry[key] !== 'string' || entry[key].length > MAX_TEXT) throw new Error('Invalid custom CCD content');
            if ((entry.kind === 'inline' && !entry.inline) || (entry.kind === 'path' && (entry.inline || !document.job.customComponents?.path))) throw new Error('Invalid custom CCD source');
        }
    }
    if (value.pathField && !document.job.customComponents?.path) throw new Error('Missing custom CCD path');
}
function restoreCustomComponents(value, document, app) {
    const restore = list => {
        const result = Object.create(null);
        for (const entry of list) {
            result[entry.id] = entry.kind === 'inline' ? { userCCD: entry.inline } : { userCCDPath: document.job.customComponents.path };
            if (entry.source) result[entry.id].source = entry.source;
            if (entry.originalCCD) result[entry.id].originalCCD = entry.originalCCD;
        }
        return result;
    };
    app.userCCDs = restore(value.entries);
    app.glycanUserCCDs = restore(value.glycanEntries);
    write('userCCDPath', value.pathField ? document.job.customComponents.path : '');
    write('userCCDId', value.draftId);
    write('userCCDInput', value.draftInline);
    const selectedMode = window.document.getElementById(value.draftMode === 'inline' ? 'inlineUserCCD' : 'fileUserCCD');
    selectedMode.checked = true;
    selectedMode.dispatchEvent(new Event('change', { bubbles: true }));
    window.activeUserCCDs = value.entries.filter(entry => !entry.source.startsWith('automatic')).map(entry => ({
        componentId: entry.id, method: entry.kind === 'inline' ? 'inline' : 'file',
        content: entry.kind === 'inline' ? 'CCD mmCIF data' : document.job.customComponents.path
    }));
    window.updateActiveUserCCDsDisplay();
}
function validateSite(site, sequon) {
    exactKeys(site, fields, 'glycosylation site');
    for (const field of fields) {
        if (typeof site[field] !== 'string' || site[field].length > MAX_TEXT) throw new Error(`Invalid site ${field}`);
    }
    const position = Number(site.position);
    if (!Number.isSafeInteger(position) || position < 1 || position > 1000000) throw new Error('Invalid site position');
    if (site.chainId && !/^[A-Z0-9]+$/.test(site.chainId)) throw new Error('Invalid glycan chain ID');
    if (!sequon && !['N', 'S', 'T', 'custom'].includes(site.residueType)) throw new Error('Invalid site residue');
}
function captureAuthoring(app) {
    let siteCount = 0;
    return app.sequences.map((sequence, index) => {
        if (!document.getElementById(`sequence_${sequence.id}`)) throw new Error('This editor contains an entity that cannot yet be snapshotted');
        const entry = { key: `entity-${index + 1}`, glycoCT: '', msaMode: '', manualSites: [], sequonSites: [],
            inactive: { glycoCT: '', ccdCodes: '', smiles: '', ionCode: '', unpairedMsa: '', pairedMsa: '', templates: [] } };
        if (sequence.type === 'ligand') {
            const type = read(`${sequence.id}_ligandType`);
            const glycoCT = read(`${sequence.id}_glycoCT`);
            if (type === 'glycan') entry.glycoCT = glycoCT;
            else entry.inactive.glycoCT = glycoCT;
            if (type !== 'file' && read(`${sequence.id}_filePath`)) throw new Error('Clear inactive ligand file path before snapshot');
            for (const [source, field] of [['ccd', 'ccdCodes'], ['smiles', 'smiles'], ['ion', 'ionCode']]) {
                if (type !== source) entry.inactive[field] = read(`${sequence.id}_${field}`);
            }
        }
        if (sequence.type === 'protein' || sequence.type === 'rna') {
            entry.msaMode = ['auto', 'path', 'direct'].find(mode => document.getElementById(`${sequence.id}_msaType${mode === 'auto' ? 'Auto' : mode === 'path' ? 'Path' : 'Direct'}`)?.checked) || 'auto';
            for (const kind of ['unpaired', 'paired']) {
                if (entry.msaMode !== 'path' && read(`${sequence.id}_${kind}MsaPath`)) throw new Error('Clear inactive MSA paths before snapshot');
                if (entry.msaMode !== 'direct') entry.inactive[`${kind}Msa`] = read(`${sequence.id}_${kind}Msa`);
            }
        }
        if (sequence.type === 'protein') {
            const templates = document.getElementById(`${sequence.id}_templates`)?.querySelectorAll('.card[id^="template_"]') || [];
            for (const card of templates) {
                const pathSelected = document.getElementById(`${card.id}_sourceTypePath`)?.checked;
                if (!pathSelected && read(`${card.id}_mmcifPath`)) throw new Error('Clear inactive template path before snapshot');
                entry.inactive.templates.push(pathSelected ? read(`${card.id}_mmcif`) : '');
            }
            for (const [container, prefix, key] of [
                ['glycosylationSites', 'glyco_', 'manualSites'], ['sequonSites', 'sequon_', 'sequonSites']
            ]) {
                const cards = document.getElementById(`${sequence.id}_${container}`)?.querySelectorAll(`.card[id^="${prefix}"]`) || [];
                for (const card of cards) {
                    if (++siteCount > MAX_SITES) throw new Error('Too many glycosylation sites');
                    const site = Object.fromEntries(fields.map(field => [field, read(`${card.id}_${field}`)]));
                    validateSite(site, key === 'sequonSites');
                    entry[key].push(site);
                }
            }
        }
        if (entry.glycoCT.length > MAX_TEXT) throw new Error('GlycoCT is too large');
        return entry;
    });
}

function validateEnvelope(input, target, core) {
    const snapshot = cloneBounded(input);
    exactKeys(snapshot, ['builder', 'builderVersion', 'documentSchemaVersion', 'target', 'revision', 'document', 'authoring', 'manualBondCount', 'customComponents', 'dependencies'], 'snapshot');
    if (snapshot.builder !== BUILDER || snapshot.builderVersion !== VERSION) throw new Error('Unsupported builder snapshot version');
    if (snapshot.documentSchemaVersion !== 1) throw new Error('Unsupported document schema version');
    if (snapshot.target !== target || snapshot.document?.target !== target) throw new Error('Snapshot target does not match the host target');
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0 || !Array.isArray(snapshot.authoring)
        || !Array.isArray(snapshot.dependencies)) throw new Error('Invalid snapshot metadata');
    const validation = core.validateSuperset(snapshot.document);
    if (!validation.valid) throw new Error(`Invalid snapshot document: ${validation.errors.join('; ')}`);
    exactKeys(snapshot.document, ['schema', 'schemaVersion', 'target', 'options', 'job'], 'document');
    if (snapshot.document.options) exactKeys(snapshot.document.options, ['alphafoldVersion'], 'document options');
    exactKeys(snapshot.document.job, ['name', 'seeds', 'entities', 'bonds', 'customComponents'], 'job');
    if (snapshot.document.job.customComponents) exactKeys(snapshot.document.job.customComponents, ['inline', 'path'], 'custom components');
    validateCustomComponents(snapshot.customComponents, snapshot.document);
    const entities = snapshot.document.job.entities;
    if (entities.length > 1000) throw new Error('Too many entities');
    let chainCount = 0;
    for (const entity of entities) {
        exactKeys(entity, ['key', 'type', 'chainIds', 'sequence', 'description', 'ligand', 'ionCode', 'modifications', 'msa', 'templates', 'templatesPath'], 'entity');
        if (entity.chainIds.length > 1000 || entity.chainIds.some(id => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) throw new Error('Invalid chain ID');
        chainCount += entity.chainIds.length;
        if (entity.sequence !== undefined && !/^[A-Z]+$/.test(entity.sequence)) throw new Error('Invalid sequence');
        if (entity.ligand) exactKeys(entity.ligand, ['source', 'ccdCodes', 'smiles', 'path'], 'ligand');
        for (const modification of entity.modifications || []) exactKeys(modification, ['ccdCode', 'position'], 'modification');
        if (entity.msa) {
            exactKeys(entity.msa, ['paired', 'unpaired'], 'MSA');
            for (const msa of Object.values(entity.msa)) exactKeys(msa, ['source', 'value'], 'MSA source');
        }
        for (const template of entity.templates || []) exactKeys(template, ['mmcif', 'mmcifPath', 'queryIndices', 'templateIndices'], 'template');
    }
    if (chainCount > 10000) throw new Error('Too many chain copies');
    for (const bond of snapshot.document.job.bonds || []) {
        exactKeys(bond, ['left', 'right'], 'bond');
        exactKeys(bond.left, ['chainId', 'position', 'atom'], 'bond endpoint');
        exactKeys(bond.right, ['chainId', 'position', 'atom'], 'bond endpoint');
    }
    if (snapshot.authoring.length > entities.length || !Number.isSafeInteger(snapshot.manualBondCount)
        || snapshot.manualBondCount < 0 || snapshot.manualBondCount > (snapshot.document.job.bonds || []).length) throw new Error('Snapshot entity or bond count mismatch');
    let count = 0;
    snapshot.authoring.forEach((entry, index) => {
        exactKeys(entry, ['key', 'glycoCT', 'msaMode', 'manualSites', 'sequonSites', 'inactive'], 'authoring entry');
        exactKeys(entry.inactive, ['glycoCT', 'ccdCodes', 'smiles', 'ionCode', 'unpairedMsa', 'pairedMsa', 'templates'], 'inactive inputs');
        for (const [key, value] of Object.entries(entry.inactive)) {
            if (key === 'templates') {
                if (!Array.isArray(value) || value.length > 1000 || value.some(item => typeof item !== 'string' || item.length > MAX_TEXT)) throw new Error('Invalid inactive templates');
            } else if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error('Invalid inactive input');
        }
        if (entry.key !== `entity-${index + 1}` || entities[index].key !== entry.key
            || typeof entry.glycoCT !== 'string' || entry.glycoCT.length > MAX_TEXT
            || !(['protein', 'rna'].includes(entities[index].type) ? ['auto', 'path', 'direct'].includes(entry.msaMode) : entry.msaMode === '')
            || !Array.isArray(entry.manualSites) || !Array.isArray(entry.sequonSites)) throw new Error('Invalid authoring entry');
        if (entry.glycoCT && entities[index].type !== 'ligand') throw new Error('GlycoCT requires a ligand');
        if ((entry.manualSites.length || entry.sequonSites.length) && entities[index].type !== 'protein') throw new Error('Sites require a protein');
        for (const site of entry.manualSites) { validateSite(site, false); count++; }
        for (const site of entry.sequonSites) { validateSite(site, true); count++; }
    });
    if (count > MAX_SITES) throw new Error('Too many glycosylation sites');
    return snapshot;
}

async function capture(resolveDependency) {
    const app = window.app;
    clearTimeout(app.generateTimeout);
    await app.generateJSON();
    if (!app.lastValidation?.valid || !app.lastInputDocument) throw new Error('Resolve validation errors before snapshot');
    const revision = app.generation;
    const target = app.getOutputTarget();
    const core = await window.JAAGCoreReady;
    const inputDocument = cloneBounded(app.lastInputDocument);
    const authoring = captureAuthoring(app);
    const customComponents = captureCustomComponents(app, inputDocument);
    const captured = await captureInputDependencies(inputDocument, resolveDependency || (() => null));
    if (app.generation !== revision || app.isRestoringSharedInput) throw new Error('Editor changed during snapshot');
    const snapshot = {
        builder: BUILDER, builderVersion: VERSION, documentSchemaVersion: 1, target, revision,
        document: captured.document, authoring, manualBondCount: app.bondedAtomPairs.length, customComponents, dependencies: captured.dependencies
    };
    validateEnvelope(snapshot, target, core);
    return { snapshot, files: captured.files };
}

async function listDependencies() {
    const app = window.app;
    clearTimeout(app.generateTimeout);
    await app.generateJSON();
    if (!app.lastValidation?.valid) throw new Error('Resolve validation errors before selecting dependencies');
    const revision = app.generation;
    const slots = await listInputDependencySlots(app.lastInputDocument);
    if (app.generation !== revision) throw new Error('Editor changed while listing dependencies');
    return slots;
}

async function restoreIntoFreshEditor(input, target, resolveDependency) {
    const app = window.app;
    if (app.sequences.length || app.bondedAtomPairs.length) throw new Error('Restore requires a fresh editor');
    clearTimeout(app.initialGenerateTimeout);
    const core = await window.JAAGCoreReady;
    const snapshot = validateEnvelope(input, target, core);
    const verified = await resolveInputDependencies(snapshot.document, snapshot.dependencies, resolveDependency || (() => null));
    const base = cloneBounded(verified.document);
    base.job.entities = base.job.entities.slice(0, snapshot.authoring.length);
    const manualBonds = (base.job.bonds || []).slice(0, snapshot.manualBondCount);
    base.job.bonds = [];
    await window.restoreJAAGDocument(base, 'Input restored');
    app.isRestoringSharedInput = true;
    try {
        restoreCustomComponents(snapshot.customComponents, verified.document, app);
        for (let index = 0; index < snapshot.authoring.length; index++) {
            const entry = snapshot.authoring[index];
            const seq = app.sequences[index];
            if (!seq) throw new Error('Restored entity missing');
            if (entry.glycoCT) {
                write(`${seq.id}_ligandType`, 'glycan');
                window.toggleLigandInputs(seq.id);
                write(`${seq.id}_glycoCT`, entry.glycoCT);
            }
            if (entry.msaMode) {
                const radio = document.getElementById(`${seq.id}_msaType${entry.msaMode === 'auto' ? 'Auto' : entry.msaMode === 'path' ? 'Path' : 'Direct'}`);
                if (!radio) throw new Error('MSA control unavailable');
                radio.checked = true;
                window.toggleMSAInput(seq.id);
            }
            if (seq.type === 'ligand') {
                for (const key of ['glycoCT', 'ccdCodes', 'smiles', 'ionCode']) {
                    if (entry.inactive[key]) write(`${seq.id}_${key}`, entry.inactive[key]);
                }
            }
            if (entry.msaMode) {
                for (const key of ['unpairedMsa', 'pairedMsa']) if (entry.inactive[key]) write(`${seq.id}_${key}`, entry.inactive[key]);
            }
            const templates = document.getElementById(`${seq.id}_templates`)?.querySelectorAll('.card[id^="template_"]') || [];
            if (templates.length !== entry.inactive.templates.length) throw new Error('Restored template count mismatch');
            entry.inactive.templates.forEach((value, templateIndex) => { if (value) write(`${templates[templateIndex].id}_mmcif`, value); });
            for (const site of entry.manualSites) {
                await new Promise(resolve => setTimeout(resolve, 2));
                window.addGlycosylationSite(seq.id);
                const card = document.getElementById(`${seq.id}_glycosylationSites`).lastElementChild;
                write(`${card.id}_position`, site.position);
                write(`${card.id}_residueType`, site.residueType);
                window.updateAtomOptions(card.id);
                write(`${card.id}_atom`, site.atom);
                write(`${card.id}_customAtom`, site.customAtom);
                write(`${card.id}_chainId`, site.chainId);
                write(`${card.id}_glycan`, site.glycan);
                write(`${card.id}_description`, site.description);
            }
            for (const [siteIndex, site] of entry.sequonSites.entries()) {
                await new Promise(resolve => setTimeout(resolve, 2));
                const sequence = snapshot.document.job.entities[index].sequence;
                const sequon = sequence.slice(Number(site.position) - 1, Number(site.position) + 2).replace(/[^A-Z]/g, '');
                window.addSequonSite(seq.id, { position: Number(site.position), sequon }, siteIndex);
                const card = document.getElementById(`${seq.id}_sequonSites`).lastElementChild;
                write(`${card.id}_chainId`, site.chainId);
                write(`${card.id}_glycan`, site.glycan);
                write(`${card.id}_description`, site.description);
            }
        }
        for (const bond of manualBonds) {
            window.addBondedAtomPair();
            const id = app.bondedAtomPairs.at(-1).id;
            for (const [side, number] of [['left', '1'], ['right', '2']]) {
                write(`${id}_chain${number}`, bond[side].chainId);
                write(`${id}_res${number}`, bond[side].position);
                write(`${id}_atom${number}`, bond[side].atom);
            }
            window.updateBondedAtomPair(id);
        }
    } finally {
        app.isRestoringSharedInput = false;
    }
    clearTimeout(app.generateTimeout);
    await app.generateJSON();
    if (!app.lastValidation?.valid) throw new Error(`Restored state is invalid: ${app.lastValidation?.errors?.join('; ') || 'generation failed'}`);
    if (!equivalent(app.lastInputDocument, snapshot.document) || !equivalent(captureAuthoring(app), snapshot.authoring)
        || !equivalent(captureCustomComponents(app, app.lastInputDocument), snapshot.customComponents)) {
        throw new Error('Restored editor cannot faithfully represent this snapshot');
    }
    return { files: verified.files };
}

async function materialize(resolveDependency) {
    const app = window.app;
    const { snapshot, files } = await capture(resolveDependency);
    const revision = snapshot.revision;
    const core = await window.JAAGCoreReady;
    const conversion = core.serialize(snapshot.document, snapshot.target);
    if (conversion.errors.length) throw new Error(conversion.errors.join('; '));
    if (app.generation !== revision || !app.lastValidation?.valid) throw new Error('Editor changed during materialization');
    const format = core.TARGETS[snapshot.target].outputFormat || 'json';
    const text = format === 'json' ? JSON.stringify(conversion.data, null, 2) : String(conversion.data);
    const bytes = new TextEncoder().encode(text);
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
    if (app.generation !== revision || !app.lastValidation?.valid) throw new Error('Editor changed during materialization');
    document.getElementById('jsonOutput').textContent = text;
    const extension = format === 'yaml' ? 'yaml' : format === 'fasta' ? 'fasta' : 'json';
    return { snapshot, revision, output: { role: 'input', name: `input.${extension}`, mime: format === 'json' ? 'application/json' : 'text/plain', bytes, sha256: digest },
        dependencies: files, diagnostics: { errors: [], warnings: [...new Set([...app.lastValidation.warnings, ...conversion.warnings])] } };
}

window.BioNuTAEditorState = Object.freeze({ capture, listDependencies, materialize, restoreIntoFreshEditor });
