import { test, expect } from '@playwright/test';

async function openBuilder(page, target) {
    await page.goto('/integration/input-builder/harness.html');
    await page.locator('#target').selectOption(target);
    await page.locator('#mount').click();
    await expect(page.locator('#status')).toHaveText('Workbench ready.', { timeout: 20000 });
    const editor = page.frameLocator('#builder iframe');
    await editor.locator("button[onclick=\"addSequence('protein')\"]").click();
    await editor.getByLabel('Protein Sequence*').fill('MNNSTAA');
    await editor.locator('#jobName').fill('Synthetic_Test');
    return editor;
}

for (const target of ['alphafold3', 'opendde', 'bioemu2']) {
    test(`${target}: bind, clone, edit, and preserve an independent upload`, async ({ page }) => {
        const editor = await openBuilder(page, target);
        await page.locator('#generate').click();
        await expect(page.locator('#ownership')).toContainText('builder');
        const original = await page.locator('#output').textContent();
        expect(original).toContain('MNNSTAA');
        await page.locator('#clone').click();
        await expect(page.locator('#status')).toContainText('Clone restored');
        await expect(page.locator('#ownership')).toContainText('empty');
        await page.locator('#generate').click();
        await expect(page.locator('#ownership')).toContainText('builder');
        expect(await page.locator('#output').textContent()).toBe(original);
        await editor.getByLabel('Protein Sequence*').fill('MNNSTAAA');
        await expect(page.locator('#ownership')).toContainText('empty');
        await page.locator('#external').setInputFiles({ name: 'external.txt', mimeType: 'text/plain', buffer: Buffer.from('independent') });
        await editor.getByLabel('Protein Sequence*').fill('MNNSTAAAA');
        await expect(page.locator('#ownership')).toContainText('external');
        await page.locator('#generate').click();
        await expect(page.locator('#status')).toContainText('Clear the independent upload');
        await expect(page.locator('#ownership')).toContainText('external');
    });
}

test('file dependencies survive a clone without retaining private paths', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator('#seq_1_advancedToggle').click();
    await editor.locator('[data-bs-target="#seq_1_msaCollapse"]').click();
    await editor.locator('#seq_1_msaTypePath').check();
    await editor.locator('#seq_1_unpairedMsaPath').fill('/private/msa.a3m');
    await page.locator('#slots').click();
    await expect(page.locator('#attachments input')).toHaveCount(1);
    await page.locator('#attachments input').setInputFiles({ name: 'msa.a3m', mimeType: 'text/plain', buffer: Buffer.from('>query\nMNNSTAA\n') });
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    const output = await page.locator('#output').textContent();
    expect(output).toContain('dependencies/dep-');
    expect(output).not.toContain('/private/');
    await page.locator('#clone').click();
    await expect(page.locator('#status')).toContainText('Clone restored');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toBe(output);
});

test('bad snapshots fail without replacing a live editor and destroy removes it', async ({ page }) => {
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const frame = holder.querySelector('iframe');
        const w = frame.contentWindow;
        w.addSequence('protein');
        const input = w.document.getElementById('seq_1_sequence'); input.value = 'MNNSTAA'; input.dispatchEvent(new Event('input', { bubbles: true }));
        const before = await builder.materialize();
        const bad = structuredClone(before.snapshot); bad.builderVersion = 999;
        let rejected = false;
        try { await builder.restore(bad); } catch { rejected = true; }
        const hostile = structuredClone(before.snapshot); hostile.document.job.entities[0].chainIds[0] = '\"><img src=x onerror=alert(1)>';
        let hostileRejected = false;
        try { await builder.restore(hostile); } catch { hostileRejected = true; }
        const unchanged = holder.querySelector('iframe') === frame && w.document.getElementById('seq_1_sequence').value === 'MNNSTAA';
        builder.destroy();
        let closed = false;
        try { await builder.validate(); } catch { closed = true; }
        return { rejected, hostileRejected, unchanged, closed, frames: holder.querySelectorAll('iframe').length };
    });
    expect(result).toEqual({ rejected: true, hostileRejected: true, unchanged: true, closed: true, frames: 0 });
});

test('restore rejects mismatched files and an edit made while it waits; destroy cancels pending work', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const frame = holder.querySelector('iframe'); const w = frame.contentWindow;
        w.addSequence('protein');
        for (const [id, value] of [['seq_1_sequence', 'MNNSTAA'], ['seq_1_unpairedMsaPath', '/private/input.a3m']]) {
            const field = w.document.getElementById(id); field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const radio = w.document.getElementById('seq_1_msaTypePath'); radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true }));
        const first = await builder.materialize(() => ({ name: 'msa.a3m', bytes: new TextEncoder().encode('original') }));
        let mismatch = false;
        try { await builder.restore(first.snapshot, () => new TextEncoder().encode('wrong')); } catch { mismatch = true; }
        const intactAfterMismatch = holder.querySelector('iframe') === frame;
        let entered, release;
        const started = new Promise(resolve => { entered = resolve; });
        const gate = new Promise(resolve => { release = resolve; });
        const pending = builder.restore(first.snapshot, async () => { entered(); await gate; return first.dependencies[0].bytes; }).then(() => false, () => true);
        await started;
        const sequence = w.document.getElementById('seq_1_sequence'); sequence.value = 'MNNSTAAA'; sequence.dispatchEvent(new Event('input', { bubbles: true }));
        release();
        const rejectedEdit = await pending;
        const editPreserved = holder.querySelector('iframe') === frame && sequence.value === 'MNNSTAAA';
        let bondStarted, releaseBond;
        const bondReady = new Promise(resolve => { bondStarted = resolve; });
        const bondGate = new Promise(resolve => { releaseBond = resolve; });
        const pendingBond = builder.restore(first.snapshot, async () => { bondStarted(); await bondGate; return first.dependencies[0].bytes; }).then(() => false, () => true);
        await bondReady;
        w.addBondedAtomPair();
        releaseBond();
        const rejectedBond = await pendingBond;
        const bondPreserved = holder.querySelector('iframe') === frame && w.app.bondedAtomPairs.length === 1;
        let startedAgain, observedSignal;
        const waiting = new Promise(resolve => { startedAgain = resolve; });
        const cancelled = builder.restore(first.snapshot, (_slot, { signal }) => { observedSignal = signal; startedAgain(); return new Promise(() => {}); }).then(() => false, () => true);
        await waiting;
        builder.destroy();
        const cancelledPromptly = await Promise.race([cancelled, new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
        return { mismatch, intactAfterMismatch, rejectedEdit, editPreserved, rejectedBond, bondPreserved, cancelledPromptly, signalAborted: observedSignal.aborted, frames: holder.querySelectorAll('iframe').length };
    });
    expect(result).toEqual({ mismatch: true, intactAfterMismatch: true, rejectedEdit: true, editPreserved: true, rejectedBond: true, bondPreserved: true, cancelledPromptly: true, signalAborted: true, frames: 0 });
});

test('a synthetic glycosylation site round trips with identical output', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    const frame = page.frameLocator('#builder iframe');
    await frame.locator("button[onclick=\"addGlycosylationSite('seq_1')\"]").click();
    const site = frame.locator('#seq_1_glycosylationSites .card').first();
    await site.locator('input[id$="_position"]').fill('2');
    await expect.poll(() => page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager?.templates?.length || 0)).toBeGreaterThan(0);
    const glyco = await page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager.templates[0].glycoct);
    await site.locator('textarea[id$="_glycan"]').fill(glyco);
    await editor.locator('button[onclick="addBondedAtomPair()"]').click();
    for (const [id, value] of Object.entries({ '#bond_1_chain1': 'A', '#bond_1_res1': '1', '#bond_1_atom1': 'CA', '#bond_1_chain2': 'GLYCANA', '#bond_1_res2': '1', '#bond_1_atom2': 'C2' })) {
        await editor.locator(id).fill(value);
    }
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    const before = await page.locator('#output').textContent();
    expect(before).toContain('bondedAtomPairs');
    await page.locator('#clone').click();
    await expect(page.locator('#status')).toContainText('Clone restored');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toBe(before);
    await expect(editor.locator('#seq_1_glycosylationSites .card textarea[id$="_glycan"]')).toHaveValue(glyco);
    await expect(editor.locator('#bond_1_chain2')).toHaveValue('GLYCANA');
});

for (const kind of ['inline', 'path']) {
    test(`custom CCD ${kind} authoring survives clone`, async ({ page }) => {
        test.setTimeout(60000);
        await page.goto('/integration/input-builder/harness.html');
        const result = await page.evaluate(async kind => {
            const { mount } = await import('/integration/input-builder/index.mjs');
            const holder = document.createElement('div'); document.body.append(holder);
            const builder = await mount(holder, { target: 'alphafold3' });
            const w = holder.querySelector('iframe').contentWindow;
            const set = (id, value) => { const input = w.document.getElementById(id); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
            w.addSequence('ligand'); set('seq_1_ligandType', 'ccd'); w.toggleLigandInputs('seq_1'); set('seq_1_ccdCodes', 'ABC-2');
            set('userCCDId', 'ABC-2');
            if (kind === 'inline') { w.document.getElementById('inlineUserCCD').checked = true; set('userCCDInput', 'data_ABC-2\n_chem_comp.id ABC-2'); }
            else set('userCCDPath', '/private/ccd.cif');
            w.addUserCCDToJSON();
            const supplied = () => ({ name: 'ccd.cif', mime: 'text/plain', bytes: new TextEncoder().encode('data_ABC-2') });
            const first = await builder.materialize(supplied);
            const files = new Map(first.dependencies.map(file => [file.id, file]));
            await builder.restore(first.snapshot, item => files.get(item.id)?.bytes);
            const restored = await builder.materialize(item => files.get(item.id));
            const child = holder.querySelector('iframe').contentWindow;
            const visible = child.document.getElementById('activeUserCCDsList').textContent.includes('ABC-2');
            const result = { same: first.output.sha256 === restored.output.sha256, visible,
                dependencies: restored.dependencies.length, leaked: JSON.stringify(restored.snapshot).includes('/private/') };
            builder.destroy(); return result;
        }, kind);
        expect(result).toEqual({ same: true, visible: true, dependencies: kind === 'path' ? 1 : 0, leaked: false });
    });
}

test('multiple instances are isolated and cross-origin editor URLs are rejected', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const left = document.createElement('div'); const right = document.createElement('div'); document.body.append(left, right);
        let crossOriginRejected = false;
        try { await mount(left, { target: 'alphafold3', editorURL: 'https://example.com/index.html' }); } catch { crossOriginRejected = true; }
        const first = await mount(left, { target: 'alphafold3' });
        const second = await mount(right, { target: 'bioemu2' });
        left.querySelector('iframe').contentWindow.addSequence('protein');
        const isolated = right.querySelector('iframe').contentWindow.app.sequences.length === 0;
        first.destroy();
        const stillReady = right.querySelectorAll('iframe').length === 1;
        second.destroy();
        return { crossOriginRejected, isolated, stillReady };
    });
    expect(result).toEqual({ crossOriginRejected: true, isolated: true, stillReady: true });
});

test('standalone YAML import uses local assets without third-party requests', async ({ page }) => {
    const external = [];
    await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
    await page.goto('/index.html');
    await page.locator('#restoreInputTarget').selectOption('boltz');
    await page.locator('#restoreInputFile').setInputFiles({ name: 'synthetic.yaml', mimeType: 'text/yaml', buffer: Buffer.from('version: 1\nsequences:\n  - protein:\n      id: A\n      sequence: MNNSTAA\n') });
    await expect(page.locator('#seq_1_sequence')).toHaveValue('MNNSTAA');
    await expect(page.locator('#outputTarget')).toHaveValue('boltz');
    expect(external).toEqual([]);
});

test('SugarDrawer popup accepts its own frame and rejects a forged sender', async ({ page }) => {
    test.setTimeout(60000);
    const external = [];
    await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    await editor.getByRole('button', { name: 'Open SugarDrawer to draw glycan structure' }).click();
    await expect(editor.locator('#sugarDrawerPopupFrame')).toBeVisible();
    await expect.poll(() => page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager?.templates?.length || 0)).toBeGreaterThan(0);
    const glyco = await page.locator('#builder iframe').evaluate(frame => frame.contentWindow.glycanTemplateManager.templates[0].glycoct);
    await editor.locator('body').evaluate((_, text) => window.postMessage({ type: 'SUGARDRAWER_ONE_CLICK_EXPORT', glycoct: text }, location.origin), glyco);
    await page.waitForTimeout(200);
    await expect(editor.locator('#seq_2_glycoCT')).toHaveValue('');
    const drawer = editor.frameLocator('#sugarDrawerPopupFrame');
    await drawer.locator('body').evaluate((_, text) => window.parent.postMessage({ type: 'SUGARDRAWER_ONE_CLICK_EXPORT', glycoct: text, requestClose: true }, location.origin), glyco);
    await expect(editor.locator('#seq_2_glycoCT')).toHaveValue(glyco);
    expect(external).toEqual([]);
});

test('glycan and automatic CCD cleanup preserve unrelated authored inputs', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    const result = await editor.locator('body').evaluate(() => {
        const w = window;
        w.app.sequences.push({ id: 'other-ligand', type: 'ligand' }, { id: 'tracked-glycan', type: 'ligand' });
        w.activeGlycans = [{ sequenceId: 'tracked-glycan', chainId: 'GLYCANA', ccdCodes: [] }];
        w.app.userCCDs = {
            MANUAL: { userCCD: 'manual' },
            AUTO: { userCCD: 'automatic', source: 'automatic-ligand' }
        };
        w.app.glycanUserCCDs = {};
        w.activeUserCCDs = [{ componentId: 'MANUAL', method: 'inline' }];
        w.confirm = () => true;
        w.clearAllGlycans();
        w.cleanupUnusedUserCCDs(new Set());
        return {
            remaining: w.app.sequences.map(sequence => sequence.id),
            ccds: Object.keys(w.app.userCCDs)
        };
    });
    expect(result.remaining).toContain('other-ligand');
    expect(result.remaining).not.toContain('tracked-glycan');
    expect(result.ccds).toContain('MANUAL');
    expect(result.ccds).not.toContain('AUTO');
});

test('inactive inline alternatives remain editable after snapshot restore', async ({ page }) => {
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const w = holder.querySelector('iframe').contentWindow;
        const set = (id, value) => { const element = w.document.getElementById(id); element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); };
        w.addSequence('protein'); set('seq_1_sequence', 'MNNSTAA'); set('jobName', 'Synthetic_Test');
        set('seq_1_unpairedMsa', '>query\nMNNSTAA');
        w.addSequence('ligand'); set('seq_2_ligandType', 'ccd'); w.toggleLigandInputs('seq_2'); set('seq_2_ccdCodes', 'ATP');
        set('seq_2_smiles', 'C(C)O'); set('seq_2_glycoCT', 'inactive GlycoCT');
        w.document.getElementById('inlineUserCCD').click(); set('userCCDId', 'DRAFT'); set('userCCDInput', 'unfinished CCD data');
        await w.app.generateJSON();
        if (!w.app.lastValidation?.valid) throw new Error(JSON.stringify(w.app.lastValidation));
        w.clearTimeout(w.app.initialGenerateTimeout);
        w.app.initialGenerateTimeout = w.setTimeout(() => w.app.generateJSON(), 0);
        const first = await builder.materialize();
        await builder.restore(first.snapshot);
        const restored = holder.querySelector('iframe').contentWindow;
        const values = ['seq_1_unpairedMsa', 'seq_2_ccdCodes', 'seq_2_smiles', 'seq_2_glycoCT', 'userCCDId', 'userCCDInput'].map(id => restored.document.getElementById(id).value);
        const second = await builder.materialize();
        builder.destroy();
        return { values, same: first.output.sha256 === second.output.sha256 };
    });
    expect(result).toEqual({ values: ['>query\nMNNSTAA', 'ATP', 'C(C)O', 'inactive GlycoCT', 'DRAFT', 'unfinished CCD data'], same: true });
});

test('inactive inline template remains editable beside its bound file', async ({ page }) => {
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const w = holder.querySelector('iframe').contentWindow;
        const set = (id, value) => { const element = w.document.getElementById(id); element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); };
        w.addSequence('protein'); set('seq_1_sequence', 'MNNSTAA'); set('jobName', 'Synthetic_Test');
        w.addTemplate('seq_1');
        const card = w.document.querySelector('#seq_1_templates .card[id^="template_"]');
        set(`${card.id}_mmcifPath`, '/private/template.cif');
        set(`${card.id}_mmcif`, 'inactive template draft');
        set(`${card.id}_queryIndices`, '0'); set(`${card.id}_templateIndices`, '0');
        const supply = () => ({ name: 'template.cif', bytes: new TextEncoder().encode('template data') });
        const first = await builder.materialize(supply);
        const files = new Map(first.dependencies.map(file => [file.id, file]));
        await builder.restore(first.snapshot, slot => files.get(slot.id)?.bytes);
        const child = holder.querySelector('iframe').contentWindow;
        const restored = child.document.querySelector('#seq_1_templates .card[id^="template_"]');
        const draft = child.document.getElementById(`${restored.id}_mmcif`).value;
        const second = await builder.materialize(slot => files.get(slot.id));
        builder.destroy();
        return { draft, same: first.output.sha256 === second.output.sha256 };
    });
    expect(result).toEqual({ draft: 'inactive template draft', same: true });
});

test('SugarDrawer loads a real core structure and exports it into the workbench', async ({ page }) => {
    const external = [];
    await page.route('https://**', route => { external.push(route.request().url()); return route.abort(); });
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    await editor.getByRole('button', { name: 'Open SugarDrawer to draw glycan structure' }).click();
    const drawer = editor.frameLocator('#sugarDrawerPopupFrame');
    await drawer.getByRole('button', { name: 'Load Structure' }).click();
    await drawer.getByText('Core', { exact: true }).first().click();
    const close = await editor.getByRole('button', { name: 'Close', exact: true }).boundingBox();
    expect(close.y).toBeGreaterThanOrEqual(0);
    await drawer.getByRole('button', { name: 'Export & Close' }).click();
    await expect(editor.locator('#seq_2_glycoCT')).toHaveValue(/RES/, { timeout: 15000 });
    await expect(editor.locator('#sugarDrawerPopupFrame')).not.toBeVisible();
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(external).toEqual([]);
});

test('adding an incomplete bond immediately invalidates a bound input', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    await editor.locator('button[onclick="addBondedAtomPair()"]').click();
    await expect(page.locator('#ownership')).toContainText('empty');
    await page.locator('#generate').click();
    await expect(page.locator('#status')).toContainText('Resolve validation errors');
    await expect(page.locator('#ownership')).toContainText('empty');
});

test('removing an automatic CCD ligand removes its generated component', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    await editor.locator('#seq_2_ligandType').selectOption('ccd');
    await editor.locator('#seq_2_ccdCodes').fill('SIA');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toContain('SIA-2');
    await editor.locator('body').evaluate(() => window.removeSequence('seq_2'));
    await expect(page.locator('#ownership')).toContainText('empty');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    const result = await page.locator('#builder iframe').evaluate(frame => ({
        stored: Object.keys(frame.contentWindow.app.userCCDs || {}),
        components: frame.contentWindow.app.lastInputDocument.job.customComponents || null
    }));
    expect(result).toEqual({ stored: [], components: null });
});

test('shared glycan substituent CCD survives until its last ligand is removed', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    const glyco = 'RES\n1b:b-dglc-HEX-1:5\n2s:sulfate\nLIN\n1:1o(6+1)2n';
    for (const id of [2, 3]) {
        await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
        await editor.locator(`#seq_${id}_glycoCT`).fill(glyco);
    }
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toContain('SO4-2');
    await editor.locator('body').evaluate(() => window.removeSequence('seq_2'));
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toContain('SO4-2');
    await editor.locator('body').evaluate(() => window.removeSequence('seq_3'));
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    const output = await page.locator('#output').textContent();
    expect(output).not.toContain('SO4-2');
    expect(output).not.toContain('userCCD');
});

test('automatic glycan CCDs do not overwrite a manual component with the same ID', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator('body').evaluate(() => {
        document.getElementById('inlineUserCCD').click();
        document.getElementById('userCCDId').value = 'SO4-2';
        document.getElementById('userCCDInput').value = 'data_MANUAL\n_chem_comp.id SO4-2';
        window.addUserCCDToJSON();
    });
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    await editor.locator('#seq_2_glycoCT').fill('RES\n1b:b-dglc-HEX-1:5\n2s:sulfate\nLIN\n1:1o(6+1)2n');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toContain('data_MANUAL');
    await editor.locator('body').evaluate(() => window.removeSequence('seq_2'));
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(await page.locator('#output').textContent()).toContain('data_MANUAL');
});

test('keyboard opens and dismisses the SugarDrawer dialog and returns focus', async ({ page }) => {
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    const opener = editor.getByRole('button', { name: 'Open SugarDrawer to draw glycan structure' });
    await editor.locator('#sugarDrawerPopupModal').evaluate(modal => modal.addEventListener('shown.bs.modal', () => { modal.dataset.testShown = 'true'; }, { once: true }));
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(editor.locator('#sugarDrawerPopupModal')).toHaveAttribute('data-test-shown', 'true');
    await expect(editor.getByRole('dialog', { name: 'SugarDrawer glycan editor' })).toBeVisible();
    const close = editor.getByRole('button', { name: 'Close', exact: true });
    await close.focus();
    await page.keyboard.press('Escape');
    await expect(editor.getByRole('dialog', { name: 'SugarDrawer glycan editor' })).not.toBeVisible();
    await expect(opener).toBeFocused();
    await editor.locator('#sugarDrawerPopupModal').evaluate(modal => {
        delete modal.dataset.testShown;
        modal.addEventListener('shown.bs.modal', () => { modal.dataset.testShown = 'true'; }, { once: true });
    });
    await page.keyboard.press('Enter');
    await expect(editor.locator('#sugarDrawerPopupModal')).toHaveAttribute('data-test-shown', 'true');
    const drawer = editor.frameLocator('#sugarDrawerPopupFrame');
    await drawer.getByRole('button', { name: 'Load Structure' }).focus();
    await page.keyboard.press('Escape');
    await expect(editor.getByRole('dialog', { name: 'SugarDrawer glycan editor' })).not.toBeVisible();
    await expect(opener).toBeFocused();
});

test('standalone and embedded workbench initialize without uncaught page errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/index.html');
    await expect(page.locator('#outputTarget')).toBeVisible();
    await openBuilder(page, 'alphafold3');
    await page.locator('#generate').click();
    await expect(page.locator('#ownership')).toContainText('builder');
    expect(errors).toEqual([]);
});

test('hostile chain IDs in native imports and shared hydration remain inert', async ({ page }) => {
    const hostile = 'A\"><img src=x onerror="window.__chainInjected=1">';
    await page.goto('/index.html');
    const input = {
        name: 'Synthetic_Test', modelSeeds: [1], dialect: 'alphafold3', version: 4,
        sequences: [{ protein: { id: hostile, sequence: 'MNNSTAA' } }],
        bondedAtomPairs: [[[hostile, 1, 'CA'], [hostile, 2, 'N']]]
    };
    await page.locator('#restoreInputTarget').selectOption('alphafold3');
    await page.locator('#restoreInputFile').setInputFiles({ name: 'hostile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(input)) });
    await expect(page.locator('#seq_1_id')).toHaveValue(hostile);
    await expect(page.locator('#bond_1_chain1_list option')).toHaveCount(1);
    expect(await page.locator('#bond_1_chain1_list option').first().getAttribute('value')).toBe(hostile);
    await expect(page.locator('#bondedAtomPairsContainer img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__chainInjected || 0)).toBe(0);
    await page.evaluate(async hostileId => {
        const document = { schema: 'jaag-superset', schemaVersion: 1, target: 'alphafold3', options: { alphafoldVersion: 4 },
            job: { name: 'Synthetic_Test', seeds: [1], entities: [{ key: 'entity-1', type: 'protein', chainIds: [hostileId], sequence: 'MNNSTAA' }],
                bonds: [{ left: { chainId: hostileId, position: 1, atom: 'CA' }, right: { chainId: hostileId, position: 2, atom: 'N' } }] } };
        await window.restoreJAAGDocument(document);
    }, hostile);
    await page.evaluate(() => window.refreshBondedAtomPairDropdowns());
    await expect(page.locator('#bond_1_chain1_list option')).toHaveCount(1);
    expect(await page.locator('#bond_1_chain1_list option').first().getAttribute('value')).toBe(hostile);
    await expect(page.locator('#bondedAtomPairsContainer img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__chainInjected || 0)).toBe(0);
});

test('different restores advance the mounted revision and match output metadata', async ({ page }) => {
    await page.goto('/integration/input-builder/harness.html');
    const result = await page.evaluate(async () => {
        const { mount } = await import('/integration/input-builder/index.mjs');
        const holder = document.createElement('div'); document.body.append(holder);
        const builder = await mount(holder, { target: 'alphafold3' });
        const revisions = [];
        builder.subscribe(event => revisions.push(event.revision));
        const w = holder.querySelector('iframe').contentWindow;
        w.addSequence('protein');
        const sequence = w.document.getElementById('seq_1_sequence');
        const set = value => { sequence.value = value; sequence.dispatchEvent(new Event('input', { bubbles: true })); };
        set('AAAA'); const first = await builder.materialize();
        set('CCCC'); const second = await builder.materialize();
        await builder.restore(first.snapshot); const restoredFirst = await builder.materialize();
        await builder.restore(second.snapshot); const restoredSecond = await builder.materialize();
        const validation = await builder.validate();
        builder.destroy();
        return { first: restoredFirst.revision, second: restoredSecond.revision, firstSnapshot: restoredFirst.snapshot.revision,
            secondSnapshot: restoredSecond.snapshot.revision, validation: validation.revision,
            firstHash: restoredFirst.output.sha256, secondHash: restoredSecond.output.sha256, revisions };
    });
    expect(result.second).toBeGreaterThan(result.first);
    expect(result.firstSnapshot).toBe(result.first);
    expect(result.secondSnapshot).toBe(result.second);
    expect(result.validation).toBe(result.second);
    expect(result.firstHash).not.toBe(result.secondHash);
    expect(result.revisions.at(-1)).toBe(result.second);
    expect(result.revisions.every((revision, index, all) => index === 0 || revision > all[index - 1])).toBe(true);
});

test('sequence visualization treats imported text as text in every highlighting mode', async ({ page }) => {
    await page.goto('/index.html');
    const result = await page.evaluate(() => {
        window.addSequence('protein');
        const value = '<img src=x onerror=window.__sequenceInjected=1>';
        document.getElementById('seq_1_sequence').value = value;
        const results = [];
        for (const draw of [
            () => window.updateSequenceVisualization('seq_1'),
            () => window.updateSequenceVisualMarking('seq_1', value, [1]),
            () => window.updateSequenceVisualWithGlycosylation('seq_1', value, [1]),
            () => window.updateSequenceVisualWithSequons('seq_1', value, [1], [2], [3])
        ]) {
            draw();
            const viz = document.getElementById('seq_1_sequenceViz');
            results.push({ images: viz.querySelectorAll('img').length, literal: viz.textContent.includes('<') });
        }
        return { results, injected: window.__sequenceInjected || 0, input: document.getElementById('seq_1_sequence').value };
    });
    expect(result.results).toEqual(Array.from({ length: 4 }, () => ({ images: 0, literal: true })));
    expect(result.injected).toBe(0);
    expect(result.input).toContain('<img');
});

test('narrow embedded SugarDrawer can select and export a structure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const editor = await openBuilder(page, 'alphafold3');
    await editor.locator("button[onclick=\"addSequence('ligand')\"]").click();
    await editor.getByRole('button', { name: 'Open SugarDrawer to draw glycan structure' }).click();
    const drawer = editor.frameLocator('#sugarDrawerPopupFrame');
    await drawer.getByRole('button', { name: 'Load Structure' }).click();
    await drawer.getByText('Core', { exact: true }).first().click();
    await drawer.getByRole('button', { name: 'Export & Close' }).click();
    await expect(editor.locator('#seq_2_glycoCT')).toHaveValue(/RES/);
});
