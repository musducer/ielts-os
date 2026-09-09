// Transient native-DnD presentation only. Answers remain in the existing attempt state.
const bankSelector = '.idp-sentence-ending-bank, .idp-match2-bank, .idp-wordbank, .idp-flowchart-bank, .idp-map-drag-bank, .mh-heading-tray';
let source: HTMLElement | null = null;
let scope = '';
let target: HTMLElement | null = null;

export function endAnswerDrag() {
    source?.removeAttribute('data-answer-dragging');
    target?.removeAttribute('data-answer-drag-over');
    source = target = null;
    scope = '';
}

export function startAnswerDrag(event: any, label: string) {
    endAnswerDrag();
    source = (event.target as HTMLElement).closest<HTMLElement>('[draggable="true"]');
    const group = source?.closest<HTMLElement>('[data-dnd-question-ids]');
    scope = group?.dataset.dndQuestionIds || '';
    if (!scope && source?.dataset.qid) {
        scope = Array.from(document.querySelectorAll<HTMLElement>('[data-dnd-question-ids]'))
            .find(el => (el.dataset.dndQuestionIds || '').split('|').includes(source!.dataset.qid!))?.dataset.dndQuestionIds || '';
    }
    source?.setAttribute('data-answer-dragging', 'true');
    const ghost = document.createElement('div');
    ghost.textContent = label.replace(/\s+/g, ' ').trim();
    const rect = source?.getBoundingClientRect();
    ghost.style.cssText = `position:fixed;left:-10000px;top:-10000px;box-sizing:border-box;width:${rect?.width || 180}px;min-height:${rect?.height || 24}px;padding:3px 8px;background:white;border:1px solid #0969da;border-radius:2px;color:#111;font:400 13px/1.25 Arial,sans-serif;pointer-events:none;cursor:move;`;
    document.body.append(ghost);
    event.dataTransfer.setDragImage(ghost, 12, 12);
    setTimeout(() => ghost.remove(), 0);
}

export function validAnswerTarget(qid: string | undefined) {
    return !!qid && (!source || !scope || scope.split('|').includes(qid));
}

export function answerBankAt(node: HTMLElement): HTMLElement | null {
    const bank = node.closest<HTMLElement>(bankSelector);
    if (!bank) return null;
    const bankScope = bank.closest<HTMLElement>('[data-dnd-question-ids]')?.dataset.dndQuestionIds || '';
    return !scope || bankScope === scope ? bank : null;
}

/** Capture phase blocks wrong-group drops before any renderer-specific handlers. */
export function feedbackAnswerDrag(event: any): boolean {
    target?.removeAttribute('data-answer-drag-over');
    target = null;
    const node = event.target as HTMLElement;
    const zone = node.closest<HTMLElement>('.idp-dropzone, .idp-map-drag-slot');
    const bank = answerBankAt(node);
    if ((zone || node.closest(bankSelector)) && (!source || (zone && !validAnswerTarget(zone.dataset.qid)) || (node.closest(bankSelector) && !bank))) {
        event.stopPropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
        return false;
    }
    target = zone || bank;
    if (target && source) {
        event.preventDefault();
        target.setAttribute('data-answer-drag-over', 'true');
    }
    return true;
}

/** Measure every label using the slot font; reserve the same wrapped height for all rows. */
export function observeSentenceEnding(root: HTMLElement, options: string[]) {
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;display:block;box-sizing:border-box;padding:2px 8px;border:1px solid;white-space:normal;overflow-wrap:anywhere;';
    document.body.append(probe);
    const measure = () => {
        const slot = root.querySelector<HTMLElement>('.idp-dropzone');
        if (!slot) return;
        probe.style.font = getComputedStyle(slot).font;
        probe.style.width = 'max-content';
        let width = 394;
        options.forEach(label => { probe.textContent = label; width = Math.max(width, Math.ceil(probe.getBoundingClientRect().width)); });
        width = Math.min(width, root.clientWidth);
        probe.style.width = `${width}px`;
        let height = 24;
        options.forEach(label => { probe.textContent = label; height = Math.max(height, Math.ceil(probe.getBoundingClientRect().height)); });
        root.style.setProperty('--sentence-slot-width', `${width}px`);
        root.style.setProperty('--sentence-slot-height', `${height}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    document.fonts.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); probe.remove(); document.fonts.removeEventListener('loadingdone', measure); };
}
