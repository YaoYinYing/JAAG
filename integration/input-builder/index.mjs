// Same-origin host adapter for the full BioNuTA workbench.
const DEFAULT_EDITOR = new URL('../../index.html', import.meta.url);
const READY_TIMEOUT_MS = 30000;

/** Mount an isolated workbench. The editor URL must be on the host's exact origin. */
export async function mount(container, { target, editorURL = DEFAULT_EDITOR.href } = {}) {
    if (!(container instanceof Element)) throw new TypeError('A container element is required');
    if (typeof target !== 'string' || !target) throw new TypeError('A target is required');
    const url = new URL(editorURL, document.baseURI);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== location.origin || url.username || url.password || url.search || url.hash) {
        throw new Error('Editor URL must be an exact same-origin URL without credentials, query or fragment');
    }
    let current = null;
    let destroyed = false;
    let restoring = false;
    let revision = 0;
    const subscribers = new Set();
    const frames = new Set();
    const operations = new Set();

    async function run(operation) {
        const controller = new AbortController();
        operations.add(controller);
        const cancelled = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Input builder was destroyed')), { once: true }));
        try { return await Promise.race([operation(controller.signal), cancelled]); }
        finally { operations.delete(controller); }
    }
    function resolverWithSignal(resolver, signal) {
        return typeof resolver === 'function' ? slot => resolver(slot, { signal }) : undefined;
    }

    function requireActive() {
        if (destroyed || !current) throw new Error('Input builder is destroyed or unavailable');
        try {
            const location = new URL(current.window.location.href);
            if (current.frame.contentWindow !== current.window || location.origin !== url.origin || location.pathname !== url.pathname
                || location.search || current.window.BioNuTAEditorState !== current.api || current.window.app !== current.app) throw new Error('navigated');
        } catch {
            throw new Error('Input builder navigated away');
        }
        if (current.window.document.getElementById('outputTarget')?.value !== target) throw new Error('Input builder target was changed');
        return current;
    }
    function notify(revision) {
        for (const subscriber of subscribers) {
            try { subscriber({ revision }); } catch (error) { console.error('Input builder subscriber failed', error); }
        }
    }
    function disposeFrame(record) {
        if (!record) return;
        record.cancel?.();
        try { record.window?.document.removeEventListener('bionuta-change', record.onChange); } catch { /* Frame navigated away. */ }
        record.modal?.removeEventListener('show.bs.modal', record.onModalShow);
        record.modal?.removeEventListener('shown.bs.modal', record.onModalShown);
        record.modal?.removeEventListener('hidden.bs.modal', record.onModalHidden);
        window.removeEventListener('resize', record.resize);
        record.observer?.disconnect();
        if (record.raf) cancelAnimationFrame(record.raf);
        if (record.scrollRaf) cancelAnimationFrame(record.scrollRaf);
        if (record.modalOpen || record.scrollRaf) record.restoreScroll?.();
        record.frame.remove();
        frames.delete(record);
    }
    async function createFrame(staging) {
        const frame = document.createElement('iframe');
        frame.title = 'BioNuTA molecular input workbench';
        frame.style.cssText = 'display:block;width:100%;border:0;min-height:600px';
        frame.hidden = staging;
        if (staging) frame.style.display = 'none';
        const record = { frame };
        frames.add(record);
        try {
            const loaded = new Promise((resolve, reject) => {
                let settled = false;
                const finish = error => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    record.cancel = null;
                    if (error) reject(error); else resolve();
                };
                const timer = setTimeout(() => finish(new Error('Input builder did not become ready')), READY_TIMEOUT_MS);
                record.cancel = () => finish(new Error('Input builder was destroyed'));
                frame.addEventListener('load', () => {
                    try {
                        if (frame.contentWindow.document.URL === url.href && frame.contentWindow.document.readyState === 'complete') finish();
                    } catch {
                        finish(new Error('Input builder navigated away'));
                    }
                });
                frame.addEventListener('error', () => finish(new Error('Input builder failed to load')), { once: true });
            });
            frame.src = url.href;
            container.append(frame);
            await loaded;
            if (destroyed) throw new Error('Input builder was destroyed');
            const child = frame.contentWindow;
            if (!child || child.location.origin !== url.origin || !child.BioNuTAEditorState || !child.app) throw new Error('Input builder is unavailable');
            const core = await new Promise((resolve, reject) => {
                let settled = false;
                const timer = setTimeout(() => finish(new Error('Input builder did not become ready')), READY_TIMEOUT_MS);
                const finish = (error, value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    record.cancel = null;
                    if (error) reject(error); else resolve(value);
                };
                record.cancel = () => finish(new Error('Input builder was destroyed'));
                Promise.resolve(child.JAAGCoreReady).then(value => finish(null, value), finish);
            });
            if (destroyed) throw new Error('Input builder was destroyed');
            if (!Object.hasOwn(core.TARGETS, target)) throw new Error(`Unsupported target: ${target}`);
            record.window = child;
            record.api = child.BioNuTAEditorState;
            record.app = child.app;
            const select = child.document.getElementById('outputTarget');
            if (!select) throw new Error('Input builder target control is unavailable');
            child.document.documentElement.classList.add('bionuta-embedded');
            select.value = target;
            select.disabled = true;
            child.app.updateOutputTargetUI();
            record.onChange = () => { if (current === record && !destroyed) notify(++revision); };
            child.document.addEventListener('bionuta-change', record.onChange);
            const resize = () => {
                if (record.raf) cancelAnimationFrame(record.raf);
                record.raf = requestAnimationFrame(() => {
                    record.raf = 0;
                    try {
                        if (frame.isConnected && !frame.hidden) frame.style.height = record.modalOpen
                            ? `${Math.max(300, window.innerHeight)}px`
                            : `${Math.max(600, Math.ceil(child.document.body.getBoundingClientRect().height))}px`;
                    } catch { /* A navigated frame is rejected by the public methods. */ }
                });
            };
            record.resize = resize;
            window.addEventListener('resize', resize);
            // A fixed-position modal needs a viewport-sized frame. The ordinary
            // editor grows with its content so the host owns the page scroll.
            record.modal = child.document.getElementById('sugarDrawerPopupModal');
            record.onModalShow = () => {
                record.scrollPositions = [];
                for (let element = frame.parentElement; element; element = element.parentElement) {
                    record.scrollPositions.push([element, element.scrollLeft, element.scrollTop]);
                }
                record.windowScroll = [window.scrollX, window.scrollY];
                record.modalOpen = true;
                frame.style.height = `${Math.max(300, window.innerHeight)}px`;
                frame.scrollIntoView({ block: 'start', inline: 'nearest' });
            };
            record.onModalHidden = () => {
                record.modalOpen = false;
                resize();
                record.scrollRaf = requestAnimationFrame(() => {
                    record.scrollRaf = 0;
                    record.restoreScroll();
                });
            };
            record.onModalShown = () => frame.scrollIntoView({ block: 'start', inline: 'nearest' });
            record.restoreScroll = () => {
                for (const [element, left, top] of record.scrollPositions || []) element.scrollTo(left, top);
                if (record.windowScroll) window.scrollTo(...record.windowScroll);
            };
            record.modal?.addEventListener('show.bs.modal', record.onModalShow);
            record.modal?.addEventListener('shown.bs.modal', record.onModalShown);
            record.modal?.addEventListener('hidden.bs.modal', record.onModalHidden);
            if (typeof ResizeObserver === 'function') {
                record.observer = new ResizeObserver(resize);
                record.observer.observe(child.document.body);
            }
            resize();
            return record;
        } catch (error) {
            disposeFrame(record);
            throw error;
        }
    }
    try {
        current = await createFrame(false);
    } catch (error) {
        destroyed = true;
        throw error;
    }
    return Object.freeze({
        version: 1,
        async validate() {
            return run(async () => {
            const record = requireActive();
            const capturedRevision = revision;
            clearTimeout(record.window.app.generateTimeout);
            await record.window.app.generateJSON();
            if (requireActive() !== record || revision !== capturedRevision) throw new Error('Input builder changed during validation');
            const result = record.window.app.lastValidation;
            if (!result) throw new Error('Editor changed during validation');
            return { ...result, revision: capturedRevision };
            });
        },
        async snapshot(resolveDependency) {
            return run(async signal => {
            const record = requireActive();
            const capturedRevision = revision;
            const result = await record.window.BioNuTAEditorState.capture(resolverWithSignal(resolveDependency, signal));
            if (requireActive() !== record || revision !== capturedRevision) throw new Error('Input builder changed during snapshot');
            result.snapshot.revision = capturedRevision;
            return result;
            });
        },
        async listDependencies() {
            return run(async () => {
            const record = requireActive();
            const result = await record.window.BioNuTAEditorState.listDependencies();
            if (requireActive() !== record) throw new Error('Input builder changed while listing dependencies');
            return result;
            });
        },
        async materialize(resolveDependency) {
            return run(async signal => {
            const record = requireActive();
            const capturedRevision = revision;
            const result = await record.window.BioNuTAEditorState.materialize(resolverWithSignal(resolveDependency, signal));
            if (requireActive() !== record || revision !== capturedRevision) throw new Error('Input builder changed during materialization');
            result.revision = capturedRevision;
            result.snapshot.revision = capturedRevision;
            return result;
            });
        },
        async restore(snapshot, resolveDependency) {
            return run(async signal => {
            if (restoring) throw new Error('Restore already in progress');
            const previous = requireActive();
            const generation = previous.window.app.generation;
            const capturedRevision = revision;
            restoring = true;
            let staged;
            try {
                staged = await createFrame(true);
                await staged.window.BioNuTAEditorState.restoreIntoFreshEditor(snapshot, target, resolverWithSignal(resolveDependency, signal));
                if (requireActive() !== previous || previous.window.app.generation !== generation || revision !== capturedRevision) throw new Error('Editor changed during restore');
                current = staged;
                staged.frame.hidden = false;
                staged.frame.style.display = 'block';
                staged.resize();
                disposeFrame(previous);
                notify(++revision);
            } catch (error) {
                disposeFrame(staged);
                throw error;
            } finally {
                restoring = false;
            }
            });
        },
        subscribe(listener) {
            requireActive();
            if (typeof listener !== 'function') throw new TypeError('A listener is required');
            subscribers.add(listener);
            return () => subscribers.delete(listener);
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const controller of operations) controller.abort();
            subscribers.clear();
            for (const record of [...frames]) disposeFrame(record);
            current = null;
        }
    });
}
