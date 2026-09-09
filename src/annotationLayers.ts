/** Semantic wrappers persist independent identities; leaf segments alone paint the result.
 * Keeping wrappers preserves rich markup and legacy note/sidebar editing without flattening
 * overlapping annotations into a destructive single-colour mark.
 */
const selector = '.student-highlight, .student-note-hl, mark.idp-highlight';
export const annotationId = () => `annotation_${crypto.randomUUID()}`;

export function applySelectionAnnotation(root: HTMLElement, type: 'HIGHLIGHT' | 'NOTE', note = ''): void {
    const id = annotationId();
    const created = String(Date.now());
    root.querySelectorAll<HTMLElement>('.idp-temp-selection').forEach(el => {
        el.className = type === 'HIGHLIGHT' ? 'student-highlight' : 'student-note-hl';
        el.dataset.annotationId = id;
        el.dataset.annotationCreated = created;
        if (type === 'NOTE') { el.dataset.note = note; el.dataset.noteId = id; }
    });
    renderAnnotationLayers(root);
}

export function renderAnnotationLayers(root: HTMLElement): void {
    root.querySelectorAll('[data-annotation-segment]').forEach(el => el.replaceWith(...Array.from(el.childNodes)));
    const wrappers = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (!wrappers.length) return;
    let legacyHash = 2166136261;
    for (const char of root.innerHTML) legacyHash = Math.imul(legacyHash ^ char.charCodeAt(0), 16777619);
    wrappers.forEach((el, index) => {
        const note = el.classList.contains('student-note-hl');
        const id = el.dataset.annotationId || (note && el.dataset.noteId) || `legacy_${legacyHash >>> 0}_${index}`;
        el.dataset.annotationId = id;
        el.dataset.annotationType = note ? 'note' : 'highlight';
        el.dataset.annotationCreated = el.dataset.annotationCreated || String(index);
        if (note) el.dataset.noteId = id;
        // Wrappers are semantic, never a competing paint layer.
        el.style.setProperty('background-color', 'transparent', 'important');
        el.style.setProperty('color', 'inherit', 'important');
    });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const leaves: Text[] = [];
    while (walker.nextNode()) leaves.push(walker.currentNode as Text);
    let offset = 0;
    const ranges = new Map<string, { start: number; end: number }>();
    leaves.forEach(text => {
        if (text.parentElement?.closest('.no-print, input, textarea, .idp-dropzone')) return;
        const start = offset;
        offset += text.length;
        const active: HTMLElement[] = [];
        for (let el = text.parentElement; el && el !== root; el = el.parentElement) {
            if (el.matches(selector)) active.push(el);
        }
        if (!active.length || !text.length) return;
        active.forEach(el => {
            const id = el.dataset.annotationId!;
            const old = ranges.get(id);
            ranges.set(id, { start: Math.min(old?.start ?? start, start), end: Math.max(old?.end ?? offset, offset) });
        });
        const highlights = new Set(active.filter(el => el.dataset.annotationType === 'highlight').map(el => el.dataset.annotationId));
        const segment = document.createElement('span');
        segment.dataset.annotationSegment = highlights.size > 1 ? 'overlap' : highlights.size ? 'highlight' : 'note';
        const bg = highlights.size > 1 ? '#ff66dd' : highlights.size ? 'var(--hlbg, #FFE066)' : 'var(--notebg, #93c5fd)';
        const fg = highlights.size > 1 ? '#000000' : highlights.size ? 'var(--hlfg, #000000)' : 'var(--notefg, #000000)';
        segment.style.setProperty('background-color', bg, 'important');
        segment.style.setProperty('color', fg, 'important');
        text.replaceWith(segment);
        segment.append(text);
    });
    wrappers.forEach(el => {
        const range = ranges.get(el.dataset.annotationId!);
        if (range) {
            el.dataset.annotationStart = String(range.start);
            el.dataset.annotationEnd = String(range.end);
        }
    });
}

export function annotationHTML(html: string): string {
    if (!/student-highlight|student-note-hl|idp-highlight|data-annotation-segment/.test(html)) return html;
    const root = document.createElement('div');
    root.innerHTML = html;
    renderAnnotationLayers(root);
    return root.innerHTML;
}

/** Newest highlight covering the clicked segment, regardless of nesting order. */
export function topHighlight(node: HTMLElement, root: HTMLElement): HTMLElement | null {
    const candidates: HTMLElement[] = [];
    for (let el: HTMLElement | null = node; el && el !== root; el = el.parentElement) {
        if (el.matches('.student-highlight, mark.idp-highlight')) candidates.push(el);
    }
    return candidates.sort((a, b) => Number(b.dataset.annotationCreated || 0) - Number(a.dataset.annotationCreated || 0))[0] || null;
}

export function removeAnnotation(root: HTMLElement, node: HTMLElement): void {
    const id = node.dataset.annotationId || node.dataset.noteId;
    const matches = id ? Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(el => (el.dataset.annotationId || el.dataset.noteId) === id) : [node];
    matches.forEach(el => el.replaceWith(...Array.from(el.childNodes)));
    root.normalize();
    renderAnnotationLayers(root);
}
