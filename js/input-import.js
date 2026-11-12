(function () {
    const YAML_MODULE_URL = 'https://cdn.jsdelivr.net/npm/js-yaml@5.5.0/dist/browser/js-yaml.esm.min.mjs';
    const MAX_INPUT_BYTES = 20 * 1024 * 1024;
    const MAX_YAML_NODES = 100000;
    const INPUT_FORMATS = Object.freeze({
        alphafold3: 'json', opendde: 'json', protenix: 'json', mol1: 'json',
        openfold3: 'json', rosettafold3: 'json', boltz: 'yaml', bioemu2: 'yaml'
    });

    function fail(message) {
        throw new Error(message);
    }

    function isRecord(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
        const prototype = Object.getPrototypeOf(value);
        return prototype === Object.prototype || prototype === null;
    }

    function requireRecord(value, label) {
        if (!isRecord(value)) fail(`${label} must be an object`);
        return value;
    }

    function requireArray(value, label) {
        if (!Array.isArray(value)) fail(`${label} must be an array`);
        return value;
    }

    function rejectUnknownKeys(value, allowedKeys, label) {
        for (const key of Object.keys(value)) {
            if (!allowedKeys.includes(key)) fail(`${label} contains unsupported field "${key}"`);
        }
    }

    function guardObjectGraph(root) {
        let count = 0;
        const pending = [root];
        const seen = new WeakSet();
        while (pending.length) {
            const current = pending.pop();
            if (!Array.isArray(current) && !isRecord(current)) continue;
            if (seen.has(current)) continue;
            seen.add(current);
            for (const key of Object.keys(current)) {
                if (++count > MAX_YAML_NODES) fail('Input file contains too many values');
                const value = current[key];
                if (Array.isArray(value) || isRecord(value)) pending.push(value);
            }
        }
    }

    function safeName(fileName) {
        const base = String(fileName || 'Imported_Job').replace(/\.(?:jsonl?|ya?ml)$/i, '');
        return base.trim() || 'Imported_Job';
    }

    function positiveInteger(value, label, fallback) {
        const number = value === undefined || value === null || value === '' ? fallback : Number(value);
        if (!Number.isInteger(number) || number < 1) fail(`${label} must be a positive integer`);
        return number;
    }

    function chainIdsFrom(value, countValue, index) {
        let ids = Array.isArray(value)
            ? value.map(item => String(item).trim()).filter(Boolean)
            : typeof value === 'string' && value.trim() ? [value.trim()] : [];
        const count = positiveInteger(countValue, `Entity ${index + 1} count`, ids.length || 1);
        if (!ids.length) {
            ids = Array.from({ length: count }, (_, copy) => `I${index + 1}${copy + 1}`);
        } else if (ids.length !== count) {
            fail(`Entity ${index + 1} count does not match its chain IDs`);
        }
        return ids;
    }

    function normalizeCcd(value) {
        if (typeof value !== 'string') fail('CCD codes must be strings');
        const code = value.trim().toUpperCase();
        return code.startsWith('CCD_') ? code.slice(4) : code;
    }

    function normalizeCodes(value, label) {
        const codes = Array.isArray(value) ? value : [value];
        const normalized = codes.map(normalizeCcd);
        if (!normalized.length || normalized.some(code => !code)) fail(`${label} requires at least one non-empty CCD code`);
        return normalized;
    }

    function normalizeSequence(value, label) {
        if (typeof value !== 'string' || !value.trim()) fail(`${label} requires a sequence`);
        return value.replace(/\s/g, '').toUpperCase();
    }

    function normalizeModifications(items, type, label) {
        if (items === undefined) return undefined;
        requireArray(items, `${label} modifications`);
        const modifications = items.map((item, index) => {
            requireRecord(item, `${label} modification ${index + 1}`);
            const code = type === 'protein'
                ? item.ptmType ?? item.ccd ?? item.ccdCode ?? item.ccd_code
                : item.modificationType ?? item.modType ?? item.ccd ?? item.ccdCode ?? item.ccd_code;
            const position = type === 'protein'
                ? item.ptmPosition ?? item.position ?? item.res_id
                : item.basePosition ?? item.modPosition ?? item.position ?? item.res_id;
            if (!code) fail(`${label} modification ${index + 1} is missing its CCD code`);
            return {
                ccdCode: normalizeCcd(code),
                position: positiveInteger(position, `${label} modification ${index + 1} position`)
            };
        });
        return modifications.length ? modifications : undefined;
    }

    function baseDocument(target, fileName, options = {}) {
        return {
            schema: 'jaag-superset',
            schemaVersion: 1,
            target,
            options: { alphafoldVersion: options.version || 4 },
            job: {
                name: String(options.name || safeName(fileName)),
                seeds: Array.isArray(options.seeds) && options.seeds.length ? options.seeds : [1],
                entities: options.entities || [],
                bonds: options.bonds || [],
                ...(options.customComponents ? { customComponents: options.customComponents } : {})
            }
        };
    }

    function parseBondEndpoint(chainId, position, atom, label) {
        if (!String(chainId || '').trim()) fail(`${label} is missing a chain ID`);
        if (!String(atom || '').trim()) fail(`${label} is missing an atom name`);
        return {
            chainId: String(chainId).trim(),
            position: positiveInteger(position, `${label} position`),
            atom: String(atom).trim()
        };
    }

    function parseServerBonds(rawBonds, entities) {
        if (rawBonds === undefined) return [];
        return requireArray(rawBonds, 'covalent_bonds').map((bond, index) => {
            const label = `Covalent bond ${index + 1}`;
            requireRecord(bond, label);
            rejectUnknownKeys(bond, ['entity1', 'copy1', 'position1', 'atom1', 'entity2', 'copy2', 'position2', 'atom2'], label);
            const entity1 = positiveInteger(bond.entity1, `${label} entity1`) - 1;
            const entity2 = positiveInteger(bond.entity2, `${label} entity2`) - 1;
            const first = entities[entity1];
            const second = entities[entity2];
            if (!first || !second) fail(`${label} references an unknown entity`);
            const copy1 = positiveInteger(bond.copy1, `${label} copy1`, 1) - 1;
            const copy2 = positiveInteger(bond.copy2, `${label} copy2`, 1) - 1;
            const chain1 = first.chainIds[copy1];
            const chain2 = second.chainIds[copy2];
            if (!chain1 || !chain2) fail(`${label} references an unknown chain copy`);
            return {
                left: parseBondEndpoint(chain1, bond.position1, bond.atom1, `${label} atom1`),
                right: parseBondEndpoint(chain2, bond.position2, bond.atom2, `${label} atom2`)
            };
        });
    }

    function parseServerLigand(value, label) {
        if (typeof value !== 'string' || !value.trim()) fail(`${label} requires a ligand value`);
        const ligand = value.trim();
        if (/^FILE_/i.test(ligand)) {
            const path = ligand.slice(5).trim();
            if (!path) fail(`${label} has an empty file path`);
            return { source: 'file', path };
        }
        if (/^CCD_/i.test(ligand)) {
            return { source: 'ccd', ccdCodes: normalizeCodes(ligand.slice(4).split('_'), label) };
        }
        return { source: 'smiles', smiles: ligand };
    }

    function parseServerJobList(raw, target, fileName) {
        const jobs = requireArray(raw, 'Input JSON');
        if (jobs.length !== 1) fail('This workbench imports one job at a time; the JSON list must contain exactly one job');
        const job = requireRecord(jobs[0], 'Job');
        if (job.userCCD !== undefined || job.userCCDPath !== undefined) {
            fail(`${window.JAAGCore.TARGETS[target].name} JSON does not support AlphaFold custom userCCD fields`);
        }
        rejectUnknownKeys(job, ['name', 'modelSeeds', 'sequences', 'covalent_bonds'], 'Job');
        if (job.modelSeeds !== undefined && (!Array.isArray(job.modelSeeds) || job.modelSeeds.length === 0)) {
            fail('Job modelSeeds must be a non-empty array');
        }
        const sequenceEntries = requireArray(job.sequences, 'Job sequences');
        const entities = sequenceEntries.map((entry, index) => {
            requireRecord(entry, `Sequence ${index + 1}`);
            const keys = Object.keys(entry);
            if (keys.length !== 1) fail(`Sequence ${index + 1} must have exactly one entity type`);
            const sourceType = keys[0];
            const type = {
                proteinChain: 'protein',
                dnaSequence: 'dna',
                rnaSequence: 'rna',
                ligand: 'ligand',
                ion: 'ion'
            }[sourceType];
            if (!type) fail(`Sequence ${index + 1} uses unsupported entity type ${sourceType}`);
            const source = requireRecord(entry[sourceType], `Sequence ${index + 1} ${sourceType}`);
            const allowed = type === 'protein' || type === 'dna' || type === 'rna'
                ? ['id', 'count', 'description', 'sequence', 'modifications', 'unpairedMsaPath', 'unpairedMsa', 'pairedMsaPath', 'pairedMsa', 'templatesPath']
                : type === 'ligand'
                    ? ['id', 'count', 'description', 'ligand']
                    : ['id', 'count', 'description', 'ion', 'ionCode'];
            rejectUnknownKeys(source, allowed, `Sequence ${index + 1} ${sourceType}`);
            if (sourceType === 'proteinChain' && target !== 'mol1' && source.templatesPath) {
                fail(`${window.JAAGCore.TARGETS[target].name} does not support Mol-1 templatesPath`);
            }
            const chainIds = chainIdsFrom(source.id, source.count, index);
            const entity = { key: `entity-${index + 1}`, type, chainIds };
            if (source.description) entity.description = String(source.description);

            if (type === 'ligand') {
                entity.ligand = parseServerLigand(source.ligand, `Sequence ${index + 1} ligand`);
            } else if (type === 'ion') {
                const ionCode = source.ionCode ?? source.ion;
                if (typeof ionCode !== 'string' || !ionCode.trim()) fail(`Sequence ${index + 1} ion requires a CCD code`);
                entity.ionCode = normalizeCcd(ionCode);
            } else {
                entity.sequence = normalizeSequence(source.sequence, `Sequence ${index + 1}`);
                if (source.modifications) {
                    const items = requireArray(source.modifications, `Sequence ${index + 1} modifications`);
                    entity.modifications = items.map((item, modIndex) => {
                        requireRecord(item, `Sequence ${index + 1} modification ${modIndex + 1}`);
                        rejectUnknownKeys(item, type === 'protein' ? ['ptmType', 'ptmPosition'] : ['modificationType', 'basePosition'], `Sequence ${index + 1} modification ${modIndex + 1}`);
                        const code = type === 'protein' ? item.ptmType : item.modificationType;
                        const position = type === 'protein' ? item.ptmPosition : item.basePosition;
                        if (!code) fail(`Sequence ${index + 1} modification ${modIndex + 1} is missing its CCD code`);
                        return { ccdCode: normalizeCcd(code), position: positiveInteger(position, `Sequence ${index + 1} modification position`) };
                    });
                }
                const msa = {};
                if (source.unpairedMsaPath && source.unpairedMsa) fail(`Sequence ${index + 1} defines both inline and path-based unpaired MSA`);
                if (source.pairedMsaPath && source.pairedMsa) fail(`Sequence ${index + 1} defines both inline and path-based paired MSA`);
                if (source.unpairedMsaPath) msa.unpaired = { source: 'path', value: String(source.unpairedMsaPath) };
                if (source.unpairedMsa) msa.unpaired = { source: 'inline', value: String(source.unpairedMsa) };
                if (source.pairedMsaPath) msa.paired = { source: 'path', value: String(source.pairedMsaPath) };
                if (source.pairedMsa) msa.paired = { source: 'inline', value: String(source.pairedMsa) };
                if (Object.keys(msa).length) entity.msa = msa;
                if (source.templatesPath) entity.templatesPath = String(source.templatesPath);
            }
            return entity;
        });
        return baseDocument(target, fileName, {
            name: job.name,
            seeds: Array.isArray(job.modelSeeds) ? job.modelSeeds : [1],
            entities,
            bonds: parseServerBonds(job.covalent_bonds, entities)
        });
    }

    function pathValue(value, label, chainCount) {
        if (typeof value === 'string') return value.trim() || undefined;
        if (Array.isArray(value)) {
            if (value.length === 0) return undefined;
            const paths = value.map(item => {
                if (typeof item !== 'string' || !item.trim()) fail(`${label} contains an empty or invalid path`);
                return item.trim();
            });
            if (paths.length !== 1 && paths.length !== chainCount) fail(`${label} count does not match chain_ids`);
            if (paths.length <= 1 || paths.every(path => path === paths[0])) return paths[0];
            fail(`${label} contains different paths for chains grouped in one JAAG entity`);
        }
        if (value === undefined || value === null) return undefined;
        fail(`${label} must be a path or an array of paths`);
    }

    function parseOpenFold3(raw, fileName) {
        const root = requireRecord(raw, 'OpenFold 3 JSON');
        rejectUnknownKeys(root, ['queries'], 'OpenFold 3 JSON');
        const queries = requireRecord(root.queries, 'OpenFold 3 queries');
        const names = Object.keys(queries);
        if (names.length !== 1) fail('This workbench imports one OpenFold 3 query at a time');
        const queryName = names[0];
        const query = requireRecord(queries[queryName], `OpenFold 3 query ${queryName}`);
        rejectUnknownKeys(query, ['chains'], `OpenFold 3 query ${queryName}`);
        const chains = requireArray(query.chains, 'OpenFold 3 chains');
        const entities = chains.map((chain, index) => {
            requireRecord(chain, `OpenFold 3 chain ${index + 1}`);
            rejectUnknownKeys(chain, [
                'molecule_type', 'chain_ids', 'sequence', 'non_canonical_residues',
                'main_msa_file_paths', 'paired_msa_file_paths', 'template_cif_paths',
                'template_alignment_file_path', 'ccd_codes', 'smiles', 'path'
            ], `OpenFold 3 chain ${index + 1}`);
            const hasTemplateCifs = Array.isArray(chain.template_cif_paths)
                ? chain.template_cif_paths.length > 0
                : Boolean(chain.template_cif_paths);
            if (hasTemplateCifs || chain.template_alignment_file_path) {
                fail('This OpenFold 3 file uses native template paths that JAAG cannot restore to its editor yet');
            }
            const type = String(chain.molecule_type || '').toLowerCase();
            if (!['protein', 'dna', 'rna', 'ligand'].includes(type)) fail(`OpenFold 3 chain ${index + 1} has unsupported molecule_type ${type}`);
            const chainIds = chainIdsFrom(chain.chain_ids, undefined, index);
            const entity = { key: `entity-${index + 1}`, type, chainIds };
            if (type === 'ligand') {
                if (chain.ccd_codes !== undefined) entity.ligand = { source: 'ccd', ccdCodes: normalizeCodes(chain.ccd_codes, `OpenFold 3 chain ${index + 1}`) };
                else if (chain.smiles) entity.ligand = { source: 'smiles', smiles: String(chain.smiles) };
                else if (chain.path) entity.ligand = { source: 'file', path: String(chain.path) };
                else fail(`OpenFold 3 chain ${index + 1} requires CCD codes or SMILES`);
                return entity;
            }
            entity.sequence = normalizeSequence(chain.sequence, `OpenFold 3 chain ${index + 1}`);
            if (type === 'protein' && chain.non_canonical_residues) {
                requireRecord(chain.non_canonical_residues, `OpenFold 3 chain ${index + 1} non_canonical_residues`);
                entity.modifications = Object.entries(chain.non_canonical_residues).map(([position, code]) => ({
                    ccdCode: normalizeCcd(code),
                    position: positiveInteger(position, `OpenFold 3 chain ${index + 1} modification position`)
                }));
            }
            const unpaired = pathValue(chain.main_msa_file_paths, `OpenFold 3 chain ${index + 1} MSA`, chainIds.length);
            const paired = pathValue(chain.paired_msa_file_paths, `OpenFold 3 chain ${index + 1} paired MSA`, chainIds.length);
            if (unpaired || paired) entity.msa = {
                ...(unpaired ? { unpaired: { source: 'path', value: unpaired } } : {}),
                ...(paired ? { paired: { source: 'path', value: paired } } : {})
            };
            return entity;
        });
        return baseDocument('openfold3', fileName, { name: queryName, entities });
    }

    const RF3_PARENT = {
        protein: { MSE: 'M', FME: 'M', SEP: 'S', TPO: 'T', PTR: 'Y', HYP: 'P', CSO: 'C', KCX: 'K', M3L: 'K', MLZ: 'K' },
        dna: { '6MA': 'A', '6OG': 'G', '5CM': 'C', '5MC': 'C' },
        rna: { PSU: 'U', H2U: 'U', '5MC': 'C', '5MU': 'U', '1MA': 'A', '2MG': 'G', '7MG': 'G' }
    };

    function parseRF3Polymer(type, encoded, label) {
        const tokens = String(encoded || '').toUpperCase().match(/\([^)]*\)|./g) || [];
        if (!tokens.length) fail(`${label} requires a sequence`);
        const sequence = [];
        const modifications = [];
        tokens.forEach((token, index) => {
            if (token.startsWith('(') && token.endsWith(')')) {
                const code = normalizeCcd(token.slice(1, -1));
                const parent = RF3_PARENT[type]?.[code] || (type === 'protein' ? 'X' : '');
                if (!parent) fail(`${label} cannot infer the parent base for modified residue ${code}`);
                sequence.push(parent);
                modifications.push({ ccdCode: code, position: index + 1 });
            } else {
                sequence.push(token);
            }
        });
        return { sequence: sequence.join(''), modifications };
    }

    function parseRF3Endpoint(value, label) {
        if (typeof value !== 'string') fail(`${label} must be a chain/residue/position/atom string`);
        const parts = value.split('/');
        if (parts.length !== 4 || !parts[1].trim()) fail(`${label} must have four slash-separated fields including a residue name`);
        return parseBondEndpoint(parts[0], parts[2], parts[3], label);
    }

    function parseRoseTTAFold3(raw, fileName) {
        const root = requireRecord(raw, 'RoseTTAFold3 JSON');
        rejectUnknownKeys(root, ['name', 'components', 'bonds'], 'RoseTTAFold3 JSON');
        const components = requireArray(root.components, 'RoseTTAFold3 components');
        const entities = components.map((component, index) => {
            requireRecord(component, `RoseTTAFold3 component ${index + 1}`);
            rejectUnknownKeys(component, [
                'chain_id', 'chain_type', 'seq', 'ccd_code', 'smiles', 'path',
                'msa_path', 'template_selection'
            ], `RoseTTAFold3 component ${index + 1}`);
            if (component.template_selection && (!Array.isArray(component.template_selection) || component.template_selection.length > 0)) {
                fail('This RoseTTAFold3 file uses template_selection fields that JAAG cannot restore yet');
            }
            const chainIds = chainIdsFrom(component.chain_id, undefined, index);
            const label = `RoseTTAFold3 component ${index + 1}`;
            if (component.ccd_code !== undefined || component.smiles || component.path || Array.isArray(component.seq)) {
                let ligand;
                if (component.ccd_code !== undefined) ligand = { source: 'ccd', ccdCodes: normalizeCodes(component.ccd_code, label) };
                else if (component.smiles) ligand = { source: 'smiles', smiles: String(component.smiles) };
                else if (component.path) ligand = { source: 'file', path: String(component.path) };
                else ligand = {
                    source: 'ccd',
                    ccdCodes: normalizeCodes(component.seq.map(code => String(code).replace(/^\((.*)\)$/, '$1')), label)
                };
                return { key: `entity-${index + 1}`, type: 'ligand', chainIds, ligand };
            }
            const type = {
                'polypeptide(L)': 'protein',
                polydeoxyribonucleotide: 'dna',
                polyribonucleotide: 'rna'
            }[component.chain_type];
            if (!type) fail(`${label} has unsupported chain_type ${component.chain_type}`);
            const parsed = parseRF3Polymer(type, component.seq, label);
            const entity = { key: `entity-${index + 1}`, type, chainIds, sequence: parsed.sequence };
            if (parsed.modifications.length) entity.modifications = parsed.modifications;
            if (component.msa_path) entity.msa = { unpaired: { source: 'path', value: String(component.msa_path) } };
            return entity;
        });
        const bonds = root.bonds === undefined ? [] : requireArray(root.bonds, 'RoseTTAFold3 bonds').map((bond, index) => {
            if (!Array.isArray(bond) || bond.length !== 2) fail(`RoseTTAFold3 bond ${index + 1} must have two endpoints`);
            return {
                left: parseRF3Endpoint(bond[0], `RoseTTAFold3 bond ${index + 1} atom1`),
                right: parseRF3Endpoint(bond[1], `RoseTTAFold3 bond ${index + 1} atom2`)
            };
        });
        return baseDocument('rosettafold3', fileName, { name: root.name, entities, bonds });
    }

    function parseBoltz(raw, fileName) {
        const root = requireRecord(raw, 'Boltz YAML');
        rejectUnknownKeys(root, ['version', 'sequences', 'constraints', 'templates'], 'Boltz YAML');
        if (root.version !== undefined && root.version !== 1) fail(`Unsupported Boltz YAML version ${root.version}`);
        if (root.templates !== undefined && (!Array.isArray(root.templates) || root.templates.length > 0)) {
            fail('Boltz template sections cannot be restored into JAAG yet');
        }
        const sequences = requireArray(root.sequences, 'Boltz sequences');
        const entities = sequences.map((entry, index) => {
            requireRecord(entry, `Boltz sequence ${index + 1}`);
            const types = Object.keys(entry);
            if (types.length !== 1) fail(`Boltz sequence ${index + 1} must have exactly one entity type`);
            const type = types[0];
            if (!['protein', 'dna', 'rna', 'ligand'].includes(type)) fail(`Boltz sequence ${index + 1} has unsupported type ${type}`);
            const block = requireRecord(entry[type], `Boltz sequence ${index + 1} ${type}`);
            rejectUnknownKeys(block, type === 'ligand'
                ? ['id', 'ccd', 'smiles']
                : ['id', 'sequence', 'msa', 'modifications'], `Boltz sequence ${index + 1} ${type}`);
            const chainIds = chainIdsFrom(block.id, undefined, index);
            const entity = { key: `entity-${index + 1}`, type, chainIds };
            if (type === 'ligand') {
                if (block.ccd) entity.ligand = { source: 'ccd', ccdCodes: normalizeCodes(String(block.ccd).split('_'), `Boltz sequence ${index + 1}`) };
                else if (block.smiles) entity.ligand = { source: 'smiles', smiles: String(block.smiles) };
                else fail(`Boltz sequence ${index + 1} requires a CCD code or SMILES`);
            } else {
                entity.sequence = normalizeSequence(block.sequence, `Boltz sequence ${index + 1}`);
                entity.modifications = normalizeModifications(block.modifications, type, `Boltz sequence ${index + 1}`);
                if (block.msa) {
                    if (type !== 'protein') fail(`Boltz ${type} MSA fields cannot be restored into JAAG yet`);
                    entity.msa = { unpaired: { source: 'path', value: String(block.msa) } };
                }
            }
            return entity;
        });
        const constraints = root.constraints === undefined ? [] : requireArray(root.constraints, 'Boltz constraints');
        const bonds = constraints.map((item, index) => {
            requireRecord(item, `Boltz constraint ${index + 1}`);
            const bond = requireRecord(item.bond, `Boltz constraint ${index + 1} bond`);
            rejectUnknownKeys(item, ['bond'], `Boltz constraint ${index + 1}`);
            rejectUnknownKeys(bond, ['atom1', 'atom2'], `Boltz constraint ${index + 1} bond`);
            const endpoint = (value, side) => {
                if (!Array.isArray(value) || value.length !== 3) fail(`Boltz constraint ${index + 1} ${side} must be [chain, position, atom]`);
                return parseBondEndpoint(value[0], value[1], value[2], `Boltz constraint ${index + 1} ${side}`);
            };
            return { left: endpoint(bond.atom1, 'atom1'), right: endpoint(bond.atom2, 'atom2') };
        });
        return baseDocument('boltz', fileName, { entities, bonds });
    }

    function parseBioEmuEndpoint(value, aliasMap, label) {
        requireRecord(value, label);
        const chainId = aliasMap[String(value.asym_id)] || String(value.asym_id || '');
        return parseBondEndpoint(chainId, value.res_id, value.name, label);
    }

    function parseBioEmu2(raw, fileName) {
        const root = requireRecord(raw, 'BioEmu2 System YAML');
        rejectUnknownKeys(root, ['entities', 'bonds', 'asym_id_to_author_id', 'contacts'], 'BioEmu2 System YAML');
        if (root.contacts !== undefined && (!Array.isArray(root.contacts) || root.contacts.length > 0)) {
            fail('BioEmu2 contact conditioning cannot be restored into JAAG yet');
        }
        const aliasMap = root.asym_id_to_author_id === undefined ? {} : requireRecord(root.asym_id_to_author_id, 'asym_id_to_author_id');
        const entities = requireArray(root.entities, 'BioEmu2 entities').map((source, index) => {
            requireRecord(source, `BioEmu2 entity ${index + 1}`);
            rejectUnknownKeys(source, [
                'entity_type', 'asym_ids', 'sequence', 'mods', 'ccd_code', 'smiles', 'mon_seq'
            ], `BioEmu2 entity ${index + 1}`);
            const type = String(source.entity_type || '');
            if (source.asym_ids === undefined) fail(`BioEmu2 entity ${index + 1} requires asym_ids`);
            const rawIds = Array.isArray(source.asym_ids) ? source.asym_ids : [source.asym_ids];
            const chainIds = chainIdsFrom(rawIds.map(id => aliasMap[String(id)] || id), rawIds.length, index);
            const entity = { key: `entity-${index + 1}`, type: type === 'branched' ? 'ligand' : type, chainIds };
            if (type === 'protein' || type === 'dna' || type === 'rna') {
                entity.sequence = normalizeSequence(source.sequence, `BioEmu2 entity ${index + 1}`);
                const mods = source.mods === undefined ? undefined : requireArray(source.mods, `BioEmu2 entity ${index + 1} mods`);
                mods?.forEach((mod, modIndex) => {
                    requireRecord(mod, `BioEmu2 entity ${index + 1} modification ${modIndex + 1}`);
                    rejectUnknownKeys(mod, ['res_id', 'ccd_code'], `BioEmu2 entity ${index + 1} modification ${modIndex + 1}`);
                });
                entity.modifications = normalizeModifications(mods?.map(mod => ({
                    position: mod.res_id,
                    ccd_code: mod.ccd_code
                })), type, `BioEmu2 entity ${index + 1}`);
            } else if (type === 'ligand') {
                if (source.ccd_code) entity.ligand = { source: 'ccd', ccdCodes: normalizeCodes(source.ccd_code, `BioEmu2 entity ${index + 1}`) };
                else if (source.smiles) entity.ligand = { source: 'smiles', smiles: String(source.smiles) };
                else fail(`BioEmu2 entity ${index + 1} requires ccd_code or smiles`);
            } else if (type === 'branched') {
                const monomers = requireArray(source.mon_seq, `BioEmu2 entity ${index + 1} mon_seq`);
                entity.ligand = {
                    source: 'ccd',
                    ccdCodes: normalizeCodes(monomers.map(monomer => requireRecord(monomer, 'BioEmu2 monomer').ccd_code), `BioEmu2 entity ${index + 1}`)
                };
            } else {
                fail(`BioEmu2 entity ${index + 1} has unsupported entity_type ${type}`);
            }
            return entity;
        });
        const bonds = root.bonds === undefined ? [] : requireArray(root.bonds, 'BioEmu2 bonds').map((item, index) => {
            requireRecord(item, `BioEmu2 bond ${index + 1}`);
            rejectUnknownKeys(item, ['atom1', 'atom2'], `BioEmu2 bond ${index + 1}`);
            for (const side of ['atom1', 'atom2']) {
                const endpoint = requireRecord(item[side], `BioEmu2 bond ${index + 1} ${side}`);
                rejectUnknownKeys(endpoint, ['name', 'res_name', 'res_id', 'asym_id'], `BioEmu2 bond ${index + 1} ${side}`);
            }
            return {
                left: parseBioEmuEndpoint(item.atom1, aliasMap, `BioEmu2 bond ${index + 1} atom1`),
                right: parseBioEmuEndpoint(item.atom2, aliasMap, `BioEmu2 bond ${index + 1} atom2`)
            };
        });
        return baseDocument('bioemu2', fileName, { entities, bonds });
    }

    async function parseSelectedTarget(text, target, fileName) {
        const core = await window.JAAGCoreReady;
        const config = core.TARGETS[target];
        if (!config || !['json', 'yaml'].includes(config.outputFormat)) fail('Select a supported JSON or YAML target before choosing a file');

        let parsed;
        if (config.outputFormat === 'json') {
            let jsonText = text;
            if (target === 'alphafold3' && /\.jsonl$/i.test(fileName)) {
                const records = text.split(/\r?\n/).filter(line => line.trim());
                if (records.length !== 1) fail('AlphaFold 3 JSONL imports must contain exactly one non-empty line/job');
                jsonText = records[0];
            }
            try {
                parsed = JSON.parse(jsonText);
            } catch (error) {
                fail(`This is not valid JSON: ${error.message}`);
            }
            guardObjectGraph(parsed);
        } else {
            try {
                const yaml = await import(YAML_MODULE_URL);
                parsed = yaml.load(text, { filename: fileName });
            } catch (error) {
                fail(`Could not parse YAML: ${error.message}`);
            }
            guardObjectGraph(parsed);
        }

        let document;
        switch (target) {
            case 'alphafold3':
                if (!isRecord(parsed) || parsed.dialect !== 'alphafold3' || !Array.isArray(parsed.sequences)) {
                    fail('The selected format is AlphaFold 3 JSON; expected an object with dialect "alphafold3" and a sequences array');
                }
                rejectUnknownKeys(parsed, ['name', 'modelSeeds', 'sequences', 'dialect', 'version', 'bondedAtomPairs', 'userCCD', 'userCCDPath'], 'AlphaFold 3 JSON');
                parsed.sequences.forEach((entry, index) => {
                    requireRecord(entry, `AlphaFold 3 sequence ${index + 1}`);
                    const kinds = Object.keys(entry);
                    if (kinds.length !== 1) fail(`AlphaFold 3 sequence ${index + 1} must have exactly one entity type`);
                    const kind = kinds[0];
                    const source = requireRecord(entry[kind], `AlphaFold 3 sequence ${index + 1} ${kind}`);
                    const allowed = kind === 'protein' || kind === 'dna' || kind === 'rna'
                        ? ['id', 'sequence', 'description', 'modifications', 'unpairedMsaPath', 'unpairedMsa', 'pairedMsaPath', 'pairedMsa', 'templates', 'templatesPath']
                        : kind === 'ligand' ? ['id', 'ccdCodes', 'smiles', 'path', 'description']
                            : kind === 'ion' ? ['id', 'ionCode', 'ion'] : [];
                    if (!allowed.length) fail(`AlphaFold 3 sequence ${index + 1} has unsupported entity type ${kind}`);
                    rejectUnknownKeys(source, allowed, `AlphaFold 3 sequence ${index + 1} ${kind}`);
                    if (source.unpairedMsa && source.unpairedMsaPath) {
                        fail(`AlphaFold 3 sequence ${index + 1} defines both inline and path-based unpaired MSA`);
                    }
                    if (source.pairedMsa && source.pairedMsaPath) {
                        fail(`AlphaFold 3 sequence ${index + 1} defines both inline and path-based paired MSA`);
                    }
                    if (source.modifications !== undefined) {
                        requireArray(source.modifications, `AlphaFold 3 sequence ${index + 1} modifications`)
                            .forEach((modification, modIndex) => {
                                requireRecord(modification, `AlphaFold 3 sequence ${index + 1} modification ${modIndex + 1}`);
                                const modKeys = kind === 'protein' ? ['ptmType', 'ptmPosition'] : ['modType', 'modPosition'];
                                rejectUnknownKeys(modification, modKeys, `AlphaFold 3 sequence ${index + 1} modification ${modIndex + 1}`);
                            });
                    }
                    if (source.templates !== undefined) {
                        requireArray(source.templates, `AlphaFold 3 sequence ${index + 1} templates`)
                            .forEach((template, templateIndex) => {
                                requireRecord(template, `AlphaFold 3 sequence ${index + 1} template ${templateIndex + 1}`);
                                rejectUnknownKeys(template, ['mmcif', 'mmcifPath', 'queryIndices', 'templateIndices'], `AlphaFold 3 sequence ${index + 1} template ${templateIndex + 1}`);
                            });
                    }
                });
                document = core.fromAlphaFold3(parsed, { target });
                break;
            case 'opendde':
            case 'protenix':
            case 'mol1':
                document = parseServerJobList(parsed, target, fileName);
                break;
            case 'openfold3':
                document = parseOpenFold3(parsed, fileName);
                break;
            case 'rosettafold3':
                document = parseRoseTTAFold3(parsed, fileName);
                break;
            case 'boltz':
                document = parseBoltz(parsed, fileName);
                break;
            case 'bioemu2':
                document = parseBioEmu2(parsed, fileName);
                break;
            default:
                fail(`Restoring ${config.name} input files is not supported`);
        }

        const validation = core.validateSuperset(document);
        if (!validation.valid) fail(validation.errors.join('; '));
        const output = core.serialize(document, target);
        if (output.errors.length) fail(`The file contains fields that cannot be restored for ${config.name}: ${output.errors.join('; ')}`);
        return document;
    }

    function updateRestoreFileState() {
        const target = document.getElementById('restoreInputTarget')?.value || '';
        const input = document.getElementById('restoreInputFile');
        if (!input) return;
        const format = INPUT_FORMATS[target];
        input.disabled = !format;
        input.accept = format === 'yaml' ? '.yaml,.yml' : target === 'alphafold3' ? '.json,.jsonl' : '.json';
        input.value = '';
    }

    async function restoreInputFile(input) {
        const file = input?.files?.[0];
        if (!file) return;
        const target = document.getElementById('restoreInputTarget')?.value || '';
        try {
            if (!target) fail('Choose the file format / target before loading a file');
            const core = await window.JAAGCoreReady;
            const config = core.TARGETS[target];
            if (!config) fail('Choose a supported JSON or YAML target');
            const extension = file.name.toLowerCase().split('.').pop();
            const isJson = extension === 'json' || (target === 'alphafold3' && extension === 'jsonl');
            const isYaml = extension === 'yaml' || extension === 'yml';
            if ((config.outputFormat === 'json' && !isJson) || (config.outputFormat === 'yaml' && !isYaml)) {
                fail(`The selected ${config.name} format expects a ${config.outputFormat.toUpperCase()} file`);
            }
            if (file.size > MAX_INPUT_BYTES) fail('Input files must be 20 MB or smaller');

            const document = await parseSelectedTarget(await file.text(), target, file.name);
            await window.restoreJAAGDocument(document, `${config.name} input restored`);
        } catch (error) {
            window.app?.showError(`Cannot restore input file: ${error.message}`);
        } finally {
            if (input) input.value = '';
        }
    }

    window.updateRestoreFileState = updateRestoreFileState;
    window.restoreInputFile = restoreInputFile;
}());
