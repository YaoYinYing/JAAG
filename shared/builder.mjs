// JAAG core builder: pure, DOM-free conversion of a JAAG "input model" into
// the neutral jaag-superset document and then into a selected target file.
//
// The input model is the contract between a form (JAAG's page, a REvoCompute
// workspace plugin, or any other host) and the shared core. It is intentionally
// close to the neutral schema so hosts can construct it from any UI.

import { SCHEMA_NAME, SCHEMA_VERSION, fromAlphaFold3, serialize, validateSuperset } from './jaag-schema.mjs';

const MODEL_ENTITY_TYPES = new Set(['protein', 'dna', 'rna', 'ligand']);
const ALPHAFOLD_VERSIONS = new Set([1, 2, 3, 4]);

function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function chainIdsOf(value) {
    if (value == null) return [];
    return (Array.isArray(value) ? value : [value])
        .map(item => String(item))
        .filter(Boolean);
}

function singleOrArray(values) {
    return values.length === 1 ? values[0] : values;
}

/**
 * Parse model seeds that may arrive as a single integer, a comma/space separated
 * string, or an array. Returns positive-integer array (no 32-bit bound here;
 * validateSuperset enforces the AlphaFold 1..4294967295 range).
 */
export function parseSeeds(seeds) {
    if (seeds == null) return [];
    if (typeof seeds === 'string') {
        seeds = seeds.split(/[,\s]+/).filter(Boolean);
    }
    if (!Array.isArray(seeds)) seeds = [seeds];
    return [...new Set(seeds.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0))];
}

function normalizeCcd(value) {
    const code = String(value || '');
    return code.startsWith('CCD_') ? code.slice(4) : code;
}

function normalizeModification(entityType, modification) {
    if (!modification || typeof modification !== 'object' || Array.isArray(modification)) return null;
    const ccdCode = normalizeCcd(
        modification.ccdCode
        || (entityType === 'protein' ? modification.ptmType : modification.modificationType)
        || modification.modType
    );
    const position = modification.position
        ?? modification.ptmPosition
        ?? modification.basePosition
        ?? modification.modPosition;
    if (!ccdCode || !Number.isInteger(position) || position < 1) return null;
    return { ccdCode, position };
}

function buildMsaFor(entityType, model) {
    const msa = {};
    const unpaired = model.msa?.unpaired;
    const paired = model.msa?.paired;
    if (unpaired && ['path', 'inline'].includes(unpaired.source) && typeof unpaired.value === 'string' && unpaired.value.trim()) {
        msa.unpaired = { source: unpaired.source, value: unpaired.value };
    }
    if (paired && ['path', 'inline'].includes(paired.source) && typeof paired.value === 'string' && paired.value.trim()) {
        if (entityType === 'protein') msa.paired = { source: paired.source, value: paired.value };
    }
    return Object.keys(msa).length > 0 ? msa : undefined;
}

function normalizeEntity(raw, index) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { error: `Entity ${index + 1} must be an object` };
    }
    const type = String(raw.type || '').toLowerCase();
    if (!MODEL_ENTITY_TYPES.has(type)) {
        return { error: `Entity ${index + 1} has unsupported type: ${raw.type}` };
    }

    const entity = {
        key: raw.key !== undefined && String(raw.key).trim() ? String(raw.key) : `entity-${index + 1}`,
        type,
        chainIds: chainIdsOf(raw.chainIds ?? raw.id)
    };

    if (raw.description !== undefined) entity.description = String(raw.description);

    const modifications = (Array.isArray(raw.modifications) ? raw.modifications : [])
        .map(modification => normalizeModification(type, modification))
        .filter(Boolean);
    if (modifications.length > 0) entity.modifications = modifications;

    const msa = buildMsaFor(type, raw);
    if (msa) entity.msa = msa;

    if (Array.isArray(raw.templates) && raw.templates.length > 0) {
        entity.templates = deepClone(raw.templates);
    }

    if (type === 'ligand') {
        const ligand = raw.ligand && typeof raw.ligand === 'object' ? raw.ligand : {};
        const source = String(ligand.source || (raw.ccdCodes || raw.ccd_code ? 'ccd' : raw.smiles ? 'smiles' : raw.path ? 'file' : '')).toLowerCase();
        if (source === 'ccd') {
            const ccdCodes = ligand.ccdCodes ?? raw.ccdCodes ?? raw.ccd_code ?? [];
            entity.ligand = { source: 'ccd', ccdCodes: (Array.isArray(ccdCodes) ? ccdCodes : [ccdCodes]).map(code => String(code).trim()).filter(Boolean) };
        } else if (source === 'smiles') {
            const smiles = ligand.smiles ?? raw.smiles;
            if (typeof smiles !== 'string' || !smiles.trim()) return { error: `Entity ${index + 1} requires a SMILES value` };
            entity.ligand = { source: 'smiles', smiles };
        } else if (source === 'file') {
            const path = ligand.path ?? raw.path;
            if (typeof path !== 'string' || !path.trim()) return { error: `Entity ${index + 1} requires a ligand file path` };
            entity.ligand = { source: 'file', path };
        } else {
            return { error: `Entity ${index + 1} requires a ligand source (ccd, smiles, or file)` };
        }
    } else {
        if (typeof raw.sequence !== 'string') {
            return { error: `Entity ${index + 1} requires sequence data` };
        }
        entity.sequence = raw.sequence.replace(/\s/g, '').toUpperCase();
    }

    return { entity };
}

function normalizeBond(raw, index) {
    const label = `Bond ${index + 1}`;
    const endpoint = (value) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return {
                chainId: String(value.chainId ?? ''),
                position: Number.isInteger(value.position) ? value.position : undefined,
                atom: String(value.atom ?? '')
            };
        }
        if (Array.isArray(value) && value.length >= 3) {
            return {
                chainId: String(value[0] ?? ''),
                position: Number.isInteger(value[1]) ? value[1] : undefined,
                atom: String(value[2] ?? '')
            };
        }
        return null;
    };

    let left;
    let right;
    if (Array.isArray(raw)) {
        if (raw.length !== 2) return { error: `${label} must be a [left, right] pair` };
        left = endpoint(raw[0]);
        right = endpoint(raw[1]);
    } else if (raw && typeof raw === 'object') {
        left = endpoint(raw.left);
        right = endpoint(raw.right);
    } else {
        return { error: `${label} must be a [left, right] pair or a {left, right} object` };
    }

    if (!left || !right) return { error: `${label} has an invalid endpoint` };
    return { bond: { left, right } };
}

/**
 * Build the neutral jaag-superset document directly from a host-supplied input
 * model. Per-entity errors are collected as strings; validateSuperset() remains
 * the authoritative gate (run by serialize()).
 */
export function buildSuperset(model, target = model?.target) {
    if (!model || typeof model !== 'object' || Array.isArray(model)) {
        throw new TypeError('JAAG input model must be an object');
    }
    const errors = [];
    const warnings = [];
    const resolvedTarget = target || 'alphafold3';

    const entities = [];
    const raws = Array.isArray(model.entities) ? model.entities : [];
    raws.forEach((raw, index) => {
        const normalized = normalizeEntity(raw, index);
        if (normalized.error) errors.push(normalized.error);
        else entities.push(normalized.entity);
    });

    const bonds = [];
    (Array.isArray(model.bonds) ? model.bonds : []).forEach((raw, index) => {
        const normalized = normalizeBond(raw, index);
        if (normalized.error) errors.push(normalized.error);
        else bonds.push(normalized.bond);
    });

    const job = {
        name: String(model.name ?? model.jobName ?? 'Untitled_Job'),
        seeds: parseSeeds(model.seeds ?? model.modelSeeds),
        entities,
        bonds
    };

    const custom = model.customComponents && typeof model.customComponents === 'object' ? model.customComponents : {};
    const inline = custom.inline ?? model.userCCD;
    const path = custom.path ?? model.userCCDPath;
    if (inline || path) {
        job.customComponents = {};
        if (inline) job.customComponents.inline = String(inline);
        if (path) job.customComponents.path = String(path);
    }

    const version = model.version ?? model.alphafoldVersion ?? 4;
    const document = {
        schema: SCHEMA_NAME,
        schemaVersion: SCHEMA_VERSION,
        target: resolvedTarget,
        options: {
            alphafoldVersion: ALPHAFOLD_VERSIONS.has(version) ? version : 4
        },
        job
    };
    if (!ALPHAFOLD_VERSIONS.has(version)) {
        warnings.push(`AlphaFold 3 version ${version} is not recognised; defaulting to version 4`);
    }

    const schemaResult = validateSuperset(document);
    return {
        document,
        errors: [...new Set([...errors, ...schemaResult.errors])],
        warnings: [...new Set([...warnings, ...schemaResult.warnings])]
    };
}

/**
 * Build an AlphaFold 3 dialect job object from a host-supplied input model.
 * This mirrors what the JAAG web form produced before the neutral-schema
 * refactor, so it can feed any existing consumer of the AF3 job shape.
 */
export function buildAlphaFold3Job(model) {
    const built = buildSuperset(model, 'alphafold3');
    if (built.errors.length > 0) {
        const error = new Error(`Cannot build AlphaFold 3 job: ${built.errors[0]}`);
        error.details = built.errors;
        throw error;
    }
    const document = built.document;
    const version = document.options.alphafoldVersion;

    const sequences = document.job.entities.map(entity => {
        const id = singleOrArray(entity.chainIds);
        if (entity.type === 'ligand') {
            const ligand = {
                id,
                ccdCodes: entity.ligand.source === 'ccd' ? [...entity.ligand.ccdCodes] : undefined,
                smiles: entity.ligand.source === 'smiles' ? entity.ligand.smiles : undefined
            };
            if (!ligand.ccdCodes) delete ligand.ccdCodes;
            if (ligand.smiles === undefined) delete ligand.smiles;
            const target = { id, ...(ligand.ccdCodes !== undefined ? { ccdCodes: ligand.ccdCodes } : {}), ...(ligand.smiles !== undefined ? { smiles: ligand.smiles } : {}) };
            if (entity.description) target.description = entity.description;
            return { ligand: target };
        }

        const target = { id, sequence: entity.sequence };
        if (entity.description) target.description = entity.description;
        if (entity.modifications?.length) {
            target.modifications = entity.modifications.map(modification => entity.type === 'protein'
                ? { ptmType: modification.ccdCode, ptmPosition: modification.position }
                : { modType: modification.ccdCode, modPosition: modification.position });
        }
        for (const kind of ['unpaired', 'paired']) {
            const entry = entity.msa?.[kind];
            if (!entry) continue;
            if (entry.source === 'path') target[`${kind}MsaPath`] = entry.value;
            else target[`${kind}Msa`] = entry.value;
        }
        if (entity.type === 'protein' && entity.templates?.length) {
            target.templates = deepClone(entity.templates);
        }
        return { [entity.type]: target };
    });

    const job = {
        name: document.job.name,
        modelSeeds: [...document.job.seeds],
        dialect: 'alphafold3',
        version,
        sequences
    };
    if (document.job.bonds.length > 0) {
        job.bondedAtomPairs = document.job.bonds.map(bond => [
            [bond.left.chainId, bond.left.position, bond.left.atom],
            [bond.right.chainId, bond.right.position, bond.right.atom]
        ]);
    }
    if (document.job.customComponents?.inline) job.userCCD = document.job.customComponents.inline;
    if (document.job.customComponents?.path) job.userCCDPath = document.job.customComponents.path;
    return job;
}

/**
 * Full pipeline: host model → neutral document → target file. Returns the same
 * shape as serialize(): { data, document, job, errors, warnings }.
 */
export function build(model, target = model?.target) {
    const resolvedTarget = target || 'alphafold3';
    const built = buildSuperset(model, resolvedTarget);
    if (built.errors.length > 0) {
        return { data: null, document: built.document, job: null, errors: built.errors, warnings: built.warnings };
    }
    const serialized = serialize(built.document, resolvedTarget);
    let job = null;
    try {
        job = buildAlphaFold3Job(model);
    } catch {
        job = null; // file-backed ligands cannot be represented in the AF3 job shape
    }
    return {
        data: serialized.data,
        document: built.document,
        job,
        errors: [...new Set([...built.errors, ...serialized.errors])],
        warnings: [...new Set([...built.warnings, ...serialized.warnings])]
    };
}

export { fromAlphaFold3, serialize, validateSuperset, SCHEMA_NAME, SCHEMA_VERSION };
