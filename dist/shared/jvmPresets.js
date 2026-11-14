"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JVM_PRESETS = void 0;
exports.findJvmPreset = findJvmPreset;
exports.JVM_PRESETS = [
    {
        id: 'none',
        labelKey: 'settings.jvmPreset.none',
        hintKey: 'settings.jvmPreset.noneHint',
        args: '',
    },
    {
        id: 'balanced',
        labelKey: 'settings.jvmPreset.balanced',
        hintKey: 'settings.jvmPreset.balancedHint',
        // Aikar's famous flags (trimmed) + G1 — good default for most PCs
        args: [
            '-XX:+UseG1GC',
            '-XX:+ParallelRefProcEnabled',
            '-XX:MaxGCPauseMillis=200',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+DisableExplicitGC',
            '-XX:G1NewSizePercent=30',
            '-XX:G1MaxNewSizePercent=40',
            '-XX:G1HeapRegionSize=8M',
            '-XX:G1ReservePercent=20',
            '-XX:InitiatingHeapOccupancyPercent=15',
            '-Dfml.ignoreInvalidMinecraftCertificates=true',
            '-Dfml.ignorePatchDiscrepancies=true',
        ].join(' '),
    },
    {
        id: 'performance',
        labelKey: 'settings.jvmPreset.performance',
        hintKey: 'settings.jvmPreset.performanceHint',
        args: [
            '-XX:+UseG1GC',
            '-XX:+ParallelRefProcEnabled',
            '-XX:MaxGCPauseMillis=100',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+DisableExplicitGC',
            '-XX:G1NewSizePercent=40',
            '-XX:G1MaxNewSizePercent=50',
            '-XX:G1HeapRegionSize=16M',
            '-XX:G1ReservePercent=15',
            '-XX:InitiatingHeapOccupancyPercent=20',
            '-XX:G1MixedGCCountTarget=4',
            '-XX:G1MixedGCLiveThresholdPercent=90',
            '-XX:G1RSetUpdatingPauseTimePercent=5',
            '-XX:SurvivorRatio=32',
            '-XX:+PerfDisableSharedMem',
            '-XX:MaxTenuringThreshold=1',
            '-Dfml.ignoreInvalidMinecraftCertificates=true',
            '-Dfml.ignorePatchDiscrepancies=true',
        ].join(' '),
    },
    {
        id: 'lowLatency',
        labelKey: 'settings.jvmPreset.lowLatency',
        hintKey: 'settings.jvmPreset.lowLatencyHint',
        // ZGC / Shenandoah style flags are version-sensitive; use G1 with aggressive pause target
        args: [
            '-XX:+UseG1GC',
            '-XX:MaxGCPauseMillis=40',
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+DisableExplicitGC',
            '-XX:G1HeapRegionSize=8M',
            '-XX:InitiatingHeapOccupancyPercent=15',
            '-XX:+AlwaysPreTouch',
            '-XX:+PerfDisableSharedMem',
            '-Dfml.ignoreInvalidMinecraftCertificates=true',
        ].join(' '),
    },
    {
        id: 'compatibility',
        labelKey: 'settings.jvmPreset.compatibility',
        hintKey: 'settings.jvmPreset.compatibilityHint',
        args: [
            '-XX:+UseG1GC',
            '-Dfml.ignoreInvalidMinecraftCertificates=true',
            '-Dfml.ignorePatchDiscrepancies=true',
            '-Djava.net.preferIPv4Stack=true',
        ].join(' '),
    },
];
function findJvmPreset(args) {
    const norm = args.trim().replace(/\s+/g, ' ');
    if (!norm)
        return 'none';
    for (const p of exports.JVM_PRESETS) {
        if (p.id === 'none')
            continue;
        if (p.args === norm)
            return p.id;
    }
    return 'custom';
}
//# sourceMappingURL=jvmPresets.js.map