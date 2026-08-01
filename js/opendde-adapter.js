// Convert JAAG's AlphaFold 3 job object to OpenDDE/Protenix's AlphaFold Server-style JSON.
(function(root) {
    'use strict';

    const ENTITY_TYPES = {
        protein: 'proteinChain',
        dna: 'dnaSequence',
        rna: 'rnaSequence',
        ligand: 'ligand'
    };

    const ALPHAFOLD_CCD_ALIASES = {
        'SIA-2': 'SIA',
        'SLB-2': 'SLB',
        'NGC-2': 'NGC',
        'NGE-2': 'NGE',
        'SO4-2': 'SO4',
        'PO4-2': 'PO4',
        'NH4': 'NH4'
    };

    function withCCDPrefix(value) {
        const normalized = String(value || '').toUpperCase();
        return normalized.startsWith('CCD_') ? normalized : `CCD_${normalized}`;
    }

    function getIds(entity) {
        if (Array.isArray(entity.id)) return entity.id.map(String);
        if (entity.id) return [String(entity.id)];
        return [];
    }

    function convertModifications(type, modifications) {
        if (!Array.isArray(modifications)) return undefined;

        if (type === 'protein') {
            return modifications.map(modification => ({
                ptmType: withCCDPrefix(modification.ptmType),
                ptmPosition: modification.ptmPosition
            }));
        }

        return modifications.map(modification => ({
            modificationType: withCCDPrefix(
                modification.modificationType || modification.modType
            ),
            basePosition: modification.basePosition || modification.modPosition
        }));
    }

    function findUserCCDIds(userCCD) {
        if (!userCCD) return [];
        return [...String(userCCD).matchAll(/^data_([^\s#]+)/gm)].map(match => match[1]);
    }

    function convert(alphaFoldJob, targetName = 'OpenDDE') {
        const errors = [];
        const warnings = [];
        const chainLookup = new Map();
        const convertedSequences = [];
        let omittedDescriptions = false;

        if (!alphaFoldJob || typeof alphaFoldJob !== 'object' || Array.isArray(alphaFoldJob)) {
            return { data: [], errors: ['AlphaFold job must be an object'], warnings };
        }

        if (alphaFoldJob.userCCDPath) {
            errors.push(`${targetName} does not support AlphaFold userCCDPath inputs`);
        }

        const userCCDIds = findUserCCDIds(alphaFoldJob.userCCD);
        const unsupportedUserCCDs = userCCDIds.filter(id => !ALPHAFOLD_CCD_ALIASES[id]);
        if (alphaFoldJob.userCCD && userCCDIds.length === 0) {
            errors.push(`${targetName} does not support custom inline userCCD data`);
        } else if (unsupportedUserCCDs.length > 0) {
            errors.push(`${targetName} does not support custom userCCD components: ${unsupportedUserCCDs.join(', ')}`);
        } else if (userCCDIds.length > 0) {
            warnings.push(`JAAG built-in CCD components were mapped to their standard CCD IDs for ${targetName}`);
        }

        const sourceSequences = Array.isArray(alphaFoldJob.sequences) ? alphaFoldJob.sequences : [];
        sourceSequences.forEach((sequenceEntry, sequenceIndex) => {
            const sourceType = Object.keys(sequenceEntry || {})[0];
            const targetType = ENTITY_TYPES[sourceType];
            const source = sequenceEntry && sequenceEntry[sourceType];

            if (!targetType || !source || typeof source !== 'object') {
                errors.push(`Sequence ${sequenceIndex + 1} has an unsupported entity type`);
                return;
            }

            const ids = getIds(source);
            const target = { count: ids.length || 1 };
            if (ids.length > 0) target.id = ids;

            ids.forEach((id, copyIndex) => {
                if (chainLookup.has(id)) {
                    errors.push(`Duplicate chain ID: ${id}`);
                } else {
                    chainLookup.set(id, {
                        entity: String(sequenceIndex + 1),
                        copy: copyIndex + 1
                    });
                }
            });

            if (source.description) omittedDescriptions = true;

            if (sourceType === 'ligand') {
                const hasCCDCodes = Array.isArray(source.ccdCodes) && source.ccdCodes.length > 0;
                const hasSmiles = typeof source.smiles === 'string' && source.smiles.length > 0;

                if (hasCCDCodes && hasSmiles) {
                    errors.push(`Ligand ${ids.join(', ') || sequenceIndex + 1} has both CCD codes and SMILES`);
                } else if (hasCCDCodes) {
                    const codes = source.ccdCodes.map(code => {
                        const normalized = String(code).toUpperCase();
                        return ALPHAFOLD_CCD_ALIASES[normalized] || normalized;
                    });
                    const invalidCodes = codes.filter(code => !/^[A-Z0-9]+$/.test(code));
                    if (invalidCodes.length > 0) {
                        errors.push(`${targetName} cannot resolve custom CCD codes: ${invalidCodes.join(', ')}`);
                    }
                    target.ligand = `CCD_${codes.join('_')}`;
                } else if (hasSmiles) {
                    target.ligand = source.smiles;
                } else {
                    errors.push(`Ligand ${ids.join(', ') || sequenceIndex + 1} requires CCD codes or SMILES`);
                }
            } else {
                target.sequence = source.sequence || '';

                const modifications = convertModifications(sourceType, source.modifications);
                if (modifications && modifications.length > 0) target.modifications = modifications;

                if (source.unpairedMsaPath) target.unpairedMsaPath = source.unpairedMsaPath;
                if (sourceType === 'protein' && source.pairedMsaPath) {
                    target.pairedMsaPath = source.pairedMsaPath;
                }
                if (source.unpairedMsa || source.pairedMsa) {
                    errors.push(`${targetName} requires MSA file paths for ${ids.join(', ') || `sequence ${sequenceIndex + 1}`}; inline MSA data is unsupported`);
                }
                if (sourceType === 'protein' && Array.isArray(source.templates) && source.templates.length > 0) {
                    errors.push(`${targetName} expects templatesPath (A3M/HHR), not AlphaFold template objects, for ${ids.join(', ') || `sequence ${sequenceIndex + 1}`}`);
                }
            }

            convertedSequences.push({ [targetType]: target });
        });

        if (omittedDescriptions) {
            warnings.push(`Sequence descriptions are not part of the ${targetName} input contract and were omitted`);
        }

        const job = {
            name: alphaFoldJob.name,
            modelSeeds: Array.isArray(alphaFoldJob.modelSeeds) ? [...alphaFoldJob.modelSeeds] : [],
            sequences: convertedSequences
        };

        const sourceBonds = Array.isArray(alphaFoldJob.bondedAtomPairs)
            ? alphaFoldJob.bondedAtomPairs
            : [];
        const covalentBonds = [];

        sourceBonds.forEach((bond, bondIndex) => {
            if (!Array.isArray(bond) || bond.length !== 2) {
                errors.push(`Bond ${bondIndex + 1} must contain exactly two atoms`);
                return;
            }

            const convertedAtoms = bond.map(atom => {
                if (!Array.isArray(atom) || atom.length !== 3) {
                    errors.push(`Bond ${bondIndex + 1} atoms must use [ChainID, ResidueID, AtomName]`);
                    return null;
                }
                const chain = chainLookup.get(String(atom[0]));
                if (!chain) {
                    errors.push(`Bond ${bondIndex + 1} references unknown chain ID: ${atom[0]}`);
                    return null;
                }
                return {
                    entity: chain.entity,
                    copy: chain.copy,
                    position: String(atom[1]),
                    atom: atom[2]
                };
            });

            if (convertedAtoms.every(Boolean)) {
                covalentBonds.push({
                    entity1: convertedAtoms[0].entity,
                    copy1: convertedAtoms[0].copy,
                    position1: convertedAtoms[0].position,
                    atom1: convertedAtoms[0].atom,
                    entity2: convertedAtoms[1].entity,
                    copy2: convertedAtoms[1].copy,
                    position2: convertedAtoms[1].position,
                    atom2: convertedAtoms[1].atom
                });
            }
        });

        if (covalentBonds.length > 0) job.covalent_bonds = covalentBonds;

        return { data: [job], errors, warnings };
    }

    function validate(data, targetName = 'OpenDDE') {
        const errors = [];
        const warnings = [];

        if (!Array.isArray(data) || data.length === 0) {
            return { valid: false, errors: [`${targetName} JSON must be a non-empty top-level list`], warnings };
        }

        data.forEach((job, jobIndex) => {
            if (!job || typeof job !== 'object' || Array.isArray(job)) {
                errors.push(`Job ${jobIndex + 1} must be an object`);
                return;
            }
            if (!job.name) errors.push(`Job ${jobIndex + 1} requires a name`);
            if (job.modelSeeds && (!Array.isArray(job.modelSeeds) || job.modelSeeds.some(seed => !Number.isInteger(seed) || seed <= 0))) {
                errors.push(`Job ${jobIndex + 1} modelSeeds must contain positive integers`);
            }
            if (!Array.isArray(job.sequences) || job.sequences.length === 0) {
                errors.push(`Job ${jobIndex + 1} requires at least one sequence`);
            }
            if (job.dialect !== undefined || job.version !== undefined) {
                errors.push(`Job ${jobIndex + 1} must not contain AlphaFold dialect or version fields`);
            }
            (job.sequences || []).forEach((entry, sequenceIndex) => {
                const keys = Object.keys(entry || {});
                if (keys.length !== 1 || !Object.values(ENTITY_TYPES).includes(keys[0])) {
                    errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} must contain one ${targetName} entity type`);
                    return;
                }
                const entity = entry[keys[0]];
                if (!Number.isInteger(entity.count) || entity.count < 1) {
                    errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} requires a positive count`);
                }
                if (entity.id && (!Array.isArray(entity.id) || entity.id.length !== entity.count)) {
                    errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} id length must match count`);
                }
                if (keys[0] === 'ligand' && !entity.ligand) {
                    errors.push(`Job ${jobIndex + 1} ligand ${sequenceIndex + 1} requires a CCD, file, or SMILES value`);
                }
                if (keys[0] !== 'ligand' && !entity.sequence) {
                    errors.push(`Job ${jobIndex + 1} sequence ${sequenceIndex + 1} requires sequence data`);
                }
            });
        });

        return { valid: errors.length === 0, errors, warnings };
    }

    const api = { convert, validate };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.OpenDDEAdapter = api;
    root.ProtenixAdapter = api;
})(typeof window !== 'undefined' ? window : globalThis);
