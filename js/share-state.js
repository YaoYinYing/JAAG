(function () {
    function setValue(id, value) {
        const element = document.getElementById(id);
        if (element && value !== undefined) element.value = value;
    }

    function setMsa(sequenceId, msa) {
        if (!msa) return;
        const values = Object.values(msa);
        const source = values[0]?.source;
        const radio = document.getElementById(`${sequenceId}_msaType${source === 'path' ? 'Path' : 'Direct'}`);
        if (radio) radio.checked = true;
        if (typeof toggleMSAInput === 'function') toggleMSAInput(sequenceId);
        for (const kind of ['unpaired', 'paired']) {
            const item = msa[kind];
            if (!item) continue;
            setValue(`${sequenceId}_${kind}Msa${item.source === 'path' ? 'Path' : ''}`, item.value);
        }
    }

    async function setModifications(sequenceId, entity) {
        const add = entity.type === 'protein' ? window.addPTM
            : entity.type === 'rna' ? window.addRNAModification
                : entity.type === 'dna' ? window.addDNAModification : null;
        if (!add) return;
        for (const modification of entity.modifications || []) {
            add(sequenceId);
            const containerId = entity.type === 'protein' ? `${sequenceId}_ptms` : `${sequenceId}_modifications`;
            const card = document.getElementById(containerId)?.lastElementChild;
            const position = card?.querySelector('input[id$="_position"]');
            const type = card?.querySelector('input[id$="_type"]');
            if (position) position.value = modification.position;
            if (type) type.value = modification.ccdCode;
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }

    async function setTemplates(sequenceId, templates) {
        for (const template of templates || []) {
            window.addTemplate(sequenceId);
            const card = document.getElementById(`${sequenceId}_templates`)?.lastElementChild;
            if (!card) continue;
            const templateId = card.id;
            const inline = template.mmcif !== undefined;
            const sourceRadio = document.getElementById(`${templateId}_sourceType${inline ? 'Inline' : 'Path'}`);
            if (sourceRadio) sourceRadio.checked = true;
            window.toggleTemplateSource?.(templateId);
            setValue(`${templateId}_${inline ? 'mmcif' : 'mmcifPath'}`, inline ? template.mmcif : template.mmcifPath);
            setValue(`${templateId}_queryIndices`, template.queryIndices?.join(','));
            setValue(`${templateId}_templateIndices`, template.templateIndices?.join(','));
            await new Promise(resolve => setTimeout(resolve, 1));
        }
    }

    async function restoreDocument(inputDocument) {
        const validation = window.JAAGCore.validateSuperset(inputDocument);
        if (!validation.valid) throw new Error(validation.errors.join('; '));
        setValue('jobName', inputDocument.job.name);
        setValue('modelSeedsMultiple', inputDocument.job.seeds.join(', '));
        setValue('version', inputDocument.options?.alphafoldVersion || 4);
        setValue('outputTarget', inputDocument.target);

        window.app.sequences = [];
        window.app.bondedAtomPairs = [];
        window.app.sequenceCounter = 0;
        window.app.bondCounter = 0;
        window.app.userCCDs = {};
        window.app.glycanUserCCDs = {};
        document.getElementById('sequencesContainer').innerHTML = '';
        const bondsContainer = document.getElementById('bondedAtomPairsContainer');
        if (bondsContainer) bondsContainer.innerHTML = '';

        for (const entity of inputDocument.job.entities) {
            window.addSequence(entity.type);
            const sequence = window.app.sequences.at(-1);
            const sequenceId = sequence.id;
            setValue(`${sequenceId}_id`, entity.chainIds[0]);
            setValue(`${sequenceId}_count`, entity.chainIds.length);
            setValue(`${sequenceId}_sequence`, entity.sequence);
            setValue(`${sequenceId}_description`, entity.description || '');
            if (entity.type === 'ligand') {
                const ligandType = entity.ligand.source === 'smiles' ? 'smiles' : 'ccd';
                setValue(`${sequenceId}_ligandType`, ligandType);
                if (typeof toggleLigandInputs === 'function') toggleLigandInputs(sequenceId);
                setValue(`${sequenceId}_ccdCodes`, entity.ligand.ccdCodes?.join(',') || '');
                setValue(`${sequenceId}_smiles`, entity.ligand.smiles || '');
            } else {
                setMsa(sequenceId, entity.msa);
                await setModifications(sequenceId, entity);
                if (entity.type === 'protein') await setTemplates(sequenceId, entity.templates);
            }
            const updateMultimer = entity.type === 'ligand' ? window.updateLigandMultimer : window.updateMultimerChains;
            if (typeof updateMultimer === 'function') updateMultimer(sequenceId);
            if (entity.chainIds.length > 1) {
                sequence.multimerChainIds = [...entity.chainIds];
                const chainList = document.getElementById(`${sequenceId}_chainList`);
                if (chainList) chainList.textContent = entity.chainIds.join(', ');
            }
            await window.updateSequenceData?.(sequenceId, entity.type);
        }

        for (const bond of inputDocument.job.bonds || []) {
            window.addBondedAtomPair();
            const bondId = window.app.bondedAtomPairs.at(-1).id;
            setValue(`${bondId}_chain1`, bond.left.chainId);
            setValue(`${bondId}_res1`, bond.left.position);
            setValue(`${bondId}_atom1`, bond.left.atom);
            setValue(`${bondId}_chain2`, bond.right.chainId);
            setValue(`${bondId}_res2`, bond.right.position);
            setValue(`${bondId}_atom2`, bond.right.atom);
            window.updateBondedAtomPair?.(bondId);
        }
        const custom = inputDocument.job.customComponents;
        if (custom?.inline) window.app.userCCDs.shared = { userCCD: custom.inline };
        if (custom?.path) setValue('userCCDPath', custom.path);
        window.app.updateOutputTargetUI();
        clearTimeout(window.app.generateTimeout);
        window.app.isRestoringSharedInput = false;
        await window.app.generateJSON();
        window.app.showSuccess('Shared JAAG input restored');
    }

    async function shareInput() {
        try {
            await window.JAAGCoreReady;
            await window.app.generateJSON();
            if (!window.app.lastValidation?.valid || !window.app.lastInputDocument) {
                throw new Error('Resolve validation errors before sharing');
            }
            const payload = window.JAAGShare.encodeSharePayload(
                window.app.lastInputDocument,
                bytes => window.pako.deflate(bytes)
            );
            const url = new URL(window.location.href);
            url.pathname = url.pathname.replace(/\/fetch$/, '/');
            url.search = '';
            url.searchParams.set('p', payload);
            await navigator.clipboard.writeText(url.href);
            window.app.showSuccess('Share link copied. Anyone with the link can read its input data.');
        } catch (error) {
            window.app.showError(`Cannot create share link: ${error.message}`);
        }
    }

    window.shareInput = shareInput;
    window.addEventListener('DOMContentLoaded', async () => {
        const payload = new URL(window.location.href).searchParams.get('p');
        if (!payload) return;
        window.app.isRestoringSharedInput = true;
        try {
            await window.JAAGCoreReady;
            const inputDocument = await window.JAAGShare.decodeSharePayload(
                payload,
                bytes => window.pako.inflate(bytes)
            );
            await restoreDocument(inputDocument);
        } catch (error) {
            window.app.isRestoringSharedInput = false;
            window.app?.showError(`Cannot restore shared input: ${error.message}`);
        }
    });
}());
