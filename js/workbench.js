// Navigation reflects the existing editor; it does not own scientific state.
(() => {
    const outline = document.getElementById('systemOutline');
    const empty = document.getElementById('outlineEmpty');
    const container = document.getElementById('sequencesContainer');
    let signature = '';

    function refreshOutline() {
        const entities = (window.app?.sequences || []).map(sequence => {
            const id = document.getElementById(`${sequence.id}_id`)?.value.trim() || 'Unassigned';
            const ligandType = document.getElementById(`${sequence.id}_ligandType`)?.value;
            const type = sequence.type === 'ligand' && ligandType === 'ion' ? 'ion' : sequence.type;
            const count = document.getElementById(`${sequence.id}_count`)?.value || '1';
            return { id: sequence.id, chain: id, type, count };
        });
        const nextSignature = JSON.stringify(entities);
        if (signature === nextSignature) return;
        signature = nextSignature;
        empty.hidden = entities.length > 0;
        outline.replaceChildren(...entities.map(entity => {
            const item = document.createElement('li');
            const link = document.createElement('a');
            link.href = `#sequence_${entity.id}`;
            link.dataset.entity = entity.id;
            const label = document.createElement('span');
            label.className = 'outline-entity-type';
            label.textContent = entity.type.toUpperCase();
            const detail = document.createElement('span');
            detail.className = 'outline-entity-detail';
            detail.textContent = `Chain ${entity.chain}${Number(entity.count) > 1 ? ` · ${entity.count} copies` : ''}`;
            link.append(label, detail);
            item.append(link);
            return item;
        }));
    }

    outline.addEventListener('click', event => {
        const link = event.target.closest('a[data-entity]');
        if (!link) return;
        const panel = document.getElementById(`${link.dataset.entity}_collapse`);
        if (panel && !panel.classList.contains('show') && window.bootstrap) {
            window.bootstrap.Collapse.getOrCreateInstance(panel, { toggle: false }).show();
        }
    });
    container.addEventListener('input', refreshOutline);
    container.addEventListener('change', refreshOutline);
    new MutationObserver(refreshOutline).observe(container, { childList: true });
    document.addEventListener('DOMContentLoaded', refreshOutline);
})();
