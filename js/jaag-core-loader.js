window.JAAGCoreReady = Promise.all([
    import('../shared/jaag-schema.mjs'),
    import('../shared/share-payload.mjs')
]).then(([schema, share]) => {
    window.JAAGCore = schema;
    window.JAAGShare = share;
    return schema;
});
