export const SCHEMA_NAME = 'jaag-superset';
export const SCHEMA_VERSION = 1;

const ENTITY_TYPES = new Set(['protein', 'dna', 'rna', 'ligand']);
const SERVER_ENTITY_TYPES = {
    protein: 'proteinChain',
    dna: 'dnaSequence',
    rna: 'rnaSequence',
    ligand: 'ligand'
};

const JAAG_CCD_ALIASES = {
    'SIA-2': 'SIA',
    'SLB-2': 'SLB',
    'NGC-2': 'NGC',
    'NGE-2': 'NGE',
    'SO4-2': 'SO4',
    'PO4-2': 'PO4',
    NH4: 'NH4'
};

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function asChainIds(value) {
    if (Array.isArray(value)) return value.filter(Boolean).map(String);
    return value ? [String(value)] : [];
}

function normalizeCCD(value) {
    const normalized = String(value || '').toUpperCase();
    return normalized.startsWith('CCD_') ? normalized.slice(4) : normalized;
}

function serverCCD(value) {
    return `CCD_${normalizeCCD(value)}`;
}

function findUserCCDIds(inline) {
    if (!inline) return [];
    return [...String(inline).matchAll(/^data_([^\s#]+)/gm)].map(match => match[1]);
}

function neutralModification(type, modification) {
    if (type === 'protein') {
        return {
            ccdCode: normalizeCCD(modification.ptmType),
            position: modification.ptmPosition
        };
    }
    return {
        ccdCode: normalizeCCD(modification.modificationType || modification.modType),
        position: modification.basePosition || modification.modPosition
    };
}

function alphaFoldModification(type, modification) {
    if (type === 'protein') {
        return { ptmType: modification.ccdCode, ptmPosition: modification.position };
    }
    return { modType: modification.ccdCode, modPosition: modification.position };
}

function serverModification(type, modification) {
    if (type === 'protein') {
        return { ptmType: serverCCD(modification.ccdCode), ptmPosition: modification.position };
    }
    return { modificationType: serverCCD(modification.ccdCode), basePosition: modification.position };
}

function readMsa(source) {
    const msa = {};
    if (source.unpairedMsaPath) msa.unpaired = { source: 'path', value: source.unpairedMsaPath };
    if (source.unpairedMsa) msa.unpaired = { source: 'inline', value: source.unpairedMsa };
    if (source.pairedMsaPath) msa.paired = { source: 'path', value: source.pairedMsaPath };
    if (source.pairedMsa) msa.paired = { source: 'inline', value: source.pairedMsa };
    return Object.keys(msa).length > 0 ? msa : undefined;
}

function writeAlphaFoldMsa(target, msa) {
    if (!msa) return;
    if (msa.unpaired?.source === 'path') target.unpairedMsaPath = msa.unpaired.value;
    if (msa.unpaired?.source === 'inline') target.unpairedMsa = msa.unpaired.value;
    if (msa.paired?.source === 'path') target.pairedMsaPath = msa.paired.value;
    if (msa.paired?.source === 'inline') target.pairedMsa = msa.paired.value;
}

export function fromAlphaFold3(alphaFoldJob, options = {}) {
    if (!alphaFoldJob || typeof alphaFoldJob !== 'object' || Array.isArray(alphaFoldJob)) {
        throw new TypeError('AlphaFold job must be an object');
    }

    const entities = (alphaFoldJob.sequences || []).map((entry, index) => {
        const type = Object.keys(entry || {})[0];
        const source = entry?.[type] || {};
        const entity = {
            key: `entity-${index + 1}`,
            type,
            chainIds: asChainIds(source.id)
        };

        if (type === 'ligand') {
            if (Array.isArray(source.ccdCodes)) {
                entity.ligand = { source: 'ccd', ccdCodes: source.ccdCodes.map(String) };
            } else if (source.smiles) {
                entity.ligand = { source: 'smiles', smiles: String(source.smiles) };
            } else {
                entity.ligand = { source: 'ccd', ccdCodes: [] };
            }
        } else {
            entity.sequence = String(source.sequence || '');
        }

        if (source.description) entity.description = String(source.description);
        if (Array.isArray(source.modifications) && source.modifications.length > 0) {
            entity.modifications = source.modifications.map(item => neutralModification(type, item));
        }

        const msa = readMsa(source);
        if (msa) entity.msa = msa;
        if (Array.isArray(source.templates) && source.templates.length > 0) {
            entity.templates = clone(source.templates);
        }
        return entity;
    });

    const bonds = (alphaFoldJob.bondedAtomPairs || []).map(pair => ({
        left: {
            chainId: String(pair?.[0]?.[0] || ''),
            position: pair?.[0]?.[1],
            atom: String(pair?.[0]?.[2] || '')
        },
        right: {
            chainId: String(pair?.[1]?.[0] || ''),
            position: pair?.[1]?.[1],
            atom: String(pair?.[1]?.[2] || '')
        }
    }));

    const document = {
        schema: SCHEMA_NAME,
        schemaVersion: SCHEMA_VERSION,
        target: options.target || 'alphafold3',
        options: {
            alphafoldVersion: alphaFoldJob.version || 4
        },
        job: {
            name: String(alphaFoldJob.name || ''),
            seeds: Array.isArray(alphaFoldJob.modelSeeds) ? [...alphaFoldJob.modelSeeds] : [],
            entities,
            bonds
        }
    };

    if (alphaFoldJob.userCCD || alphaFoldJob.userCCDPath) {
        document.job.customComponents = {};
        if (alphaFoldJob.userCCD) document.job.customComponents.inline = String(alphaFoldJob.userCCD);
        if (alphaFoldJob.userCCDPath) document.job.customComponents.path = String(alphaFoldJob.userCCDPath);
    }
    return document;
}

function validateMsa(entity, errors, ref) {
    if (!entity.msa) return;
    for (const kind of ['paired', 'unpaired']) {
        const msa = entity.msa[kind];
        if (!msa) continue;
        if (!['path', 'inline'].includes(msa.source) || typeof msa.value !== 'string' || !msa.value) {
            errors.push(`${ref} ${kind} MSA requires a non-empty path or inline value`);
        }
        if (entity.type !== 'protein' && kind === 'paired') {
            errors.push(`${ref} paired MSA is supported only for proteins`);
        }
    }
}

function validateEndpoint(endpoint, errors, ref, chainIds) {
    if (!endpoint || typeof endpoint !== 'object') {
        errors.push(`${ref} must be an object`);
        return;
    }
    if (!chainIds.has(endpoint.chainId)) errors.push(`${ref} references unknown chain ID: ${endpoint.chainId}`);
    if (!Number.isInteger(endpoint.position) || endpoint.position < 1) errors.push(`${ref} position must be a positive integer`);
    if (typeof endpoint.atom !== 'string' || !endpoint.atom) errors.push(`${ref} atom is required`);
}

export function validateSuperset(document) {
    const errors = [];
    const warnings = [];
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        return { valid: false, errors: ['JAAG input must be an object'], warnings };
    }
    if (document.schema !== SCHEMA_NAME) errors.push(`schema must be ${SCHEMA_NAME}`);
    if (document.schemaVersion !== SCHEMA_VERSION) errors.push(`Unsupported schemaVersion: ${document.schemaVersion}`);
    if (!TARGETS[document.target]) errors.push(`Unsupported target: ${document.target}`);

    const job = document.job;
    if (!job || typeof job !== 'object' || Array.isArray(job)) {
        errors.push('job must be an object');
        return { valid: false, errors, warnings };
    }
    if (typeof job.name !== 'string' || !job.name) errors.push('Job name is required');
    if (!Array.isArray(job.seeds) || job.seeds.length === 0) {
        errors.push('At least one model seed is required');
    } else if (job.seeds.some(seed => !Number.isInteger(seed) || seed <= 0)) {
        errors.push('Model seeds must contain positive integers');
    }
    const entities = Array.isArray(job.entities) ? job.entities : [];
    if (!Array.isArray(job.entities)) {
        errors.push('Entities must be an array');
    } else if (entities.length === 0) {
        errors.push('At least one entity is required');
    }

    const keys = new Set();
    const chainIds = new Set();
    entities.forEach((entity, index) => {
        const ref = `Entity ${index + 1}`;
        if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
            errors.push(`${ref} must be an object`);
            return;
        }
        if (typeof entity.key !== 'string' || !entity.key) errors.push(`${ref} key is required`);
        else if (keys.has(entity.key)) errors.push(`Duplicate entity key: ${entity.key}`);
        else keys.add(entity.key);
        if (!ENTITY_TYPES.has(entity.type)) errors.push(`${ref} has unsupported type: ${entity.type}`);
        if (!Array.isArray(entity.chainIds) || entity.chainIds.length === 0) {
            errors.push(`${ref} requires at least one chain ID`);
        } else {
            entity.chainIds.forEach(chainId => {
                if (typeof chainId !== 'string' || !chainId) errors.push(`${ref} has an invalid chain ID`);
                else if (chainIds.has(chainId)) errors.push(`Duplicate chain ID: ${chainId}`);
                else chainIds.add(chainId);
            });
        }
        if (entity.type === 'ligand') {
            const ligand = entity.ligand;
            if (!ligand || !['ccd', 'smiles', 'file'].includes(ligand.source)) {
                errors.push(`${ref} requires a ligand source`);
            } else if (ligand.source === 'ccd' && (!Array.isArray(ligand.ccdCodes) || ligand.ccdCodes.length === 0)) {
                errors.push(`${ref} requires at least one CCD code`);
            } else if (ligand.source === 'smiles' && !ligand.smiles) {
                errors.push(`${ref} requires a SMILES value`);
            } else if (ligand.source === 'file' && !ligand.path) {
                errors.push(`${ref} requires a ligand file path`);
            }
        } else if (typeof entity.sequence !== 'string' || !entity.sequence) {
            errors.push(`${ref} requires sequence data`);
        }
        if (entity.modifications !== undefined && !Array.isArray(entity.modifications)) {
            errors.push(`${ref} modifications must be an array`);
        }
        (Array.isArray(entity.modifications) ? entity.modifications : []).forEach((modification, modIndex) => {
            if (!modification || typeof modification !== 'object' || Array.isArray(modification)
                || !modification.ccdCode || !Number.isInteger(modification.position) || modification.position < 1) {
                errors.push(`${ref} modification ${modIndex + 1} requires a CCD code and positive position`);
            }
        });
        if (entity.templates !== undefined && !Array.isArray(entity.templates)) {
            errors.push(`${ref} templates must be an array`);
        } else if (entity.templates?.some(template => !template || typeof template !== 'object' || Array.isArray(template))) {
            errors.push(`${ref} templates must contain objects`);
        }
        validateMsa(entity, errors, ref);
    });

    if (job.bonds !== undefined && !Array.isArray(job.bonds)) errors.push('Bonds must be an array');
    (Array.isArray(job.bonds) ? job.bonds : []).forEach((bond, index) => {
        validateEndpoint(bond?.left, errors, `Bond ${index + 1} left endpoint`, chainIds);
        validateEndpoint(bond?.right, errors, `Bond ${index + 1} right endpoint`, chainIds);
    });
    if (job.customComponents !== undefined
        && (!job.customComponents || typeof job.customComponents !== 'object' || Array.isArray(job.customComponents))) {
        errors.push('Custom components must be an object');
    }
    if (job.customComponents?.inline !== undefined && typeof job.customComponents.inline !== 'string') {
        errors.push('Inline custom components must be a string');
    }
    if (job.customComponents?.path !== undefined && typeof job.customComponents.path !== 'string') {
        errors.push('Custom component path must be a string');
    }
    return { valid: errors.length === 0, errors, warnings };
}

export function serializeAlphaFold3(document) {
    const errors = [];
    const warnings = [];
    const version = document.options?.alphafoldVersion || 4;
    if (![1, 2, 3, 4].includes(version)) errors.push('AlphaFold 3 version must be 1, 2, 3, or 4');

    const sequences = document.job.entities.map(entity => {
        const target = {
            id: entity.chainIds.length === 1 ? entity.chainIds[0] : [...entity.chainIds]
        };
        if (entity.type === 'ligand') {
            if (entity.ligand.source === 'ccd') target.ccdCodes = [...entity.ligand.ccdCodes];
            else if (entity.ligand.source === 'smiles') target.smiles = entity.ligand.smiles;
            else errors.push(`AlphaFold 3 does not support ligand file paths for ${entity.chainIds.join(', ')}`);
        } else {
            target.sequence = entity.sequence;
            if (entity.modifications?.length) {
                target.modifications = entity.modifications.map(item => alphaFoldModification(entity.type, item));
            }
            writeAlphaFoldMsa(target, entity.msa);
            if (entity.type === 'protein' && entity.templates?.length) target.templates = clone(entity.templates);
        }
        if (entity.description) target.description = entity.description;
        return { [entity.type]: target };
    });

    const data = {
        name: document.job.name,
        modelSeeds: [...document.job.seeds],
        dialect: 'alphafold3',
        version,
        sequences
    };
    if (document.job.bonds?.length) {
        data.bondedAtomPairs = document.job.bonds.map(bond => [
            [bond.left.chainId, bond.left.position, bond.left.atom],
            [bond.right.chainId, bond.right.position, bond.right.atom]
        ]);
    }
    if (document.job.customComponents?.inline) data.userCCD = document.job.customComponents.inline;
    if (document.job.customComponents?.path) data.userCCDPath = document.job.customComponents.path;
    return { data, errors, warnings };
}

function validateServerData(data, targetName) {
    const errors = [];
    const warnings = [];
    if (!Array.isArray(data) || data.length === 0) {
        return { valid: false, errors: [`${targetName} JSON must be a non-empty top-level list`], warnings };
    }
    data.forEach((job, jobIndex) => {
        if (!job?.name) errors.push(`Job ${jobIndex + 1} requires a name`);
        if (!Array.isArray(job?.modelSeeds) || job.modelSeeds.some(seed => !Number.isInteger(seed) || seed <= 0)) {
            errors.push(`Job ${jobIndex + 1} modelSeeds must contain positive integers`);
        }
        if (!Array.isArray(job?.sequences) || job.sequences.length === 0) {
            errors.push(`Job ${jobIndex + 1} requires at least one sequence`);
        }
        (job?.sequences || []).forEach((entry, sequenceIndex) => {
            const type = Object.keys(entry || {})[0];
            const entity = entry?.[type];
            if (!Object.values(SERVER_ENTITY_TYPES).includes(type) || Object.keys(entry || {}).length !== 1) {
                errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} must contain one ${targetName} entity type`);
                return;
            }
            if (!Number.isInteger(entity?.count) || entity.count < 1) {
                errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} requires a positive count`);
            }
            if (entity?.id && (!Array.isArray(entity.id) || entity.id.length !== entity.count)) {
                errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} id length must match count`);
            }
            if (type === 'ligand' && !entity?.ligand) errors.push(`Job ${jobIndex + 1} ligand ${sequenceIndex + 1} requires ligand data`);
            if (type !== 'ligand' && !entity?.sequence) errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} requires sequence data`);
        });
    });
    return { valid: errors.length === 0, errors, warnings };
}

export function serializeServerStyle(document, targetName) {
    const errors = [];
    const warnings = [];
    const chainLookup = new Map();
    const custom = document.job.customComponents || {};
    if (custom.path) errors.push(`${targetName} does not support AlphaFold userCCDPath inputs`);

    const userCCDIds = findUserCCDIds(custom.inline);
    const unsupported = userCCDIds.filter(id => !JAAG_CCD_ALIASES[id]);
    if (custom.inline && userCCDIds.length === 0) {
        errors.push(`${targetName} does not support custom inline userCCD data`);
    } else if (unsupported.length > 0) {
        errors.push(`${targetName} does not support custom userCCD components: ${unsupported.join(', ')}`);
    } else if (userCCDIds.length > 0) {
        warnings.push(`JAAG built-in CCD components were mapped to their standard CCD IDs for ${targetName}`);
    }

    const sequences = document.job.entities.map((entity, index) => {
        const target = { count: entity.chainIds.length, id: [...entity.chainIds] };
        entity.chainIds.forEach((chainId, copyIndex) => {
            chainLookup.set(chainId, { entity: String(index + 1), copy: copyIndex + 1 });
        });
        if (entity.description) warnings.push(`Sequence descriptions are not part of the ${targetName} input contract and were omitted`);

        if (entity.type === 'ligand') {
            if (entity.ligand.source === 'ccd') {
                const codes = entity.ligand.ccdCodes.map(code => {
                    const normalized = normalizeCCD(code);
                    return JAAG_CCD_ALIASES[normalized] || normalized;
                });
                const invalid = codes.filter(code => !/^[A-Z0-9]+$/.test(code));
                if (invalid.length) errors.push(`${targetName} cannot resolve custom CCD codes: ${invalid.join(', ')}`);
                target.ligand = `CCD_${codes.join('_')}`;
            } else if (entity.ligand.source === 'smiles') {
                target.ligand = entity.ligand.smiles;
            } else if (entity.ligand.source === 'file') {
                target.ligand = `FILE_${entity.ligand.path}`;
            }
        } else {
            target.sequence = entity.sequence;
            if (entity.modifications?.length) {
                target.modifications = entity.modifications.map(item => serverModification(entity.type, item));
            }
            for (const kind of ['unpaired', 'paired']) {
                const msa = entity.msa?.[kind];
                if (!msa) continue;
                if (msa.source === 'inline') {
                    errors.push(`${targetName} requires MSA file paths for ${entity.chainIds.join(', ')}; inline MSA data is unsupported`);
                } else if (kind === 'unpaired') target.unpairedMsaPath = msa.value;
                else if (entity.type === 'protein') target.pairedMsaPath = msa.value;
            }
            if (entity.type === 'protein' && entity.templates?.length) {
                errors.push(`${targetName} expects templatesPath (A3M/HHR), not AlphaFold template objects, for ${entity.chainIds.join(', ')}`);
            }
        }
        return { [SERVER_ENTITY_TYPES[entity.type]]: target };
    });

    const job = {
        name: document.job.name,
        modelSeeds: [...document.job.seeds],
        sequences
    };
    if (document.job.bonds?.length) {
        job.covalent_bonds = document.job.bonds.flatMap((bond, index) => {
            const left = chainLookup.get(bond.left.chainId);
            const right = chainLookup.get(bond.right.chainId);
            if (!left || !right) {
                errors.push(`Bond ${index + 1} references an unknown chain ID`);
                return [];
            }
            return [{
                entity1: left.entity,
                copy1: left.copy,
                position1: String(bond.left.position),
                atom1: bond.left.atom,
                entity2: right.entity,
                copy2: right.copy,
                position2: String(bond.right.position),
                atom2: bond.right.atom
            }];
        });
    }
    const data = [job];
    const contract = validateServerData(data, targetName);
    return {
        data,
        errors: [...new Set([...errors, ...contract.errors])],
        warnings: [...new Set([...warnings, ...contract.warnings])]
    };
}

export const ADAPTERS = Object.freeze({
    alphafold3: Object.freeze({
        name: 'AlphaFold 3',
        serialize: serializeAlphaFold3
    }),
    opendde: Object.freeze({
        name: 'OpenDDE',
        serialize: document => serializeServerStyle(document, 'OpenDDE')
    }),
    protenix: Object.freeze({
        name: 'Protenix',
        serialize: document => serializeServerStyle(document, 'Protenix')
    })
});

export const TARGETS = Object.freeze({
    alphafold3: Object.freeze({
        name: 'AlphaFold 3',
        usesServerJSON: false,
        capabilities: Object.freeze({ inlineMsa: true, msaPaths: true, templates: true, customComponents: true })
    }),
    opendde: Object.freeze({
        name: 'OpenDDE',
        usesServerJSON: true,
        capabilities: Object.freeze({ inlineMsa: false, msaPaths: true, templates: false, customComponents: false })
    }),
    protenix: Object.freeze({
        name: 'Protenix',
        usesServerJSON: true,
        capabilities: Object.freeze({ inlineMsa: false, msaPaths: true, templates: false, customComponents: false })
    })
});

export function serialize(document, target = document?.target) {
    const schemaValidation = validateSuperset(document);
    if (!schemaValidation.valid) {
        return { data: null, errors: schemaValidation.errors, warnings: schemaValidation.warnings };
    }
    const adapter = ADAPTERS[target];
    if (!adapter) return { data: null, errors: [`Unsupported target: ${target}`], warnings: [] };
    const result = adapter.serialize(document);
    return {
        data: result.data,
        errors: [...new Set(result.errors || [])],
        warnings: [...new Set(result.warnings || [])]
    };
}
