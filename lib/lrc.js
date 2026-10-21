// Pure helpers (no gi imports) so they can be unit-tested in node.
export function parseLrc(text) {
    const out = [];
    if (!text)
        return out;
    for (const raw of text.split(/\r?\n/)) {
        let line = raw.trim();
        const stamps = [];
        let m;
        while ((m = /^\[(\d+):(\d+(?:\.\d+)?)\]/.exec(line))) {
            stamps.push(Math.round((parseInt(m[1], 10) * 60 + parseFloat(m[2])) * 1000));
            line = line.slice(m[0].length);
        }
        if (!stamps.length)
            continue;
        const t = line.trim();
        for (const ms of stamps)
            out.push({t: ms, text: t});
    }
    out.sort((a, b) => a.t - b.t);
    return out;
}

// index of the line active at posMs, -1 before first line
export function lineAt(lines, posMs) {
    if (!lines || !lines.length || posMs < lines[0].t)
        return -1;
    let lo = 0, hi = lines.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (lines[mid].t <= posMs)
            lo = mid;
        else
            hi = mid - 1;
    }
    return lo;
}
