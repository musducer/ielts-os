"""Ordered, source-addressed OOXML ingestion shared by text and media processing."""
from __future__ import annotations

import hashlib
import mimetypes
import posixpath
import re
import zipfile
from collections import Counter
from typing import Any, Iterator
from lxml import etree
from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.text.run import Run

IR_VERSION = "2026-09-13.ordered-ooxml-v2"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_FALSE_VALUES = {"0", "false", "off", "no", "none"}


def local(node: Any) -> str:
    return str(node.tag).rsplit('}', 1)[-1]


def source_parts(archive: zipfile.ZipFile) -> list[str]:
    """Return the main document and only the header/footer parts it references.

    Orphaned header/footer definitions are common after Word editing. Parsing
    every ZIP member would turn invisible, unreferenced text into exam content.
    """
    document_part = 'word/document.xml'
    parts = [document_part]
    if document_part not in archive.namelist():
        return parts
    rels = relationships(archive, document_part)
    root = etree.fromstring(archive.read(document_part))
    for node in visible_nodes(root):
        if local(node) not in {'headerReference', 'footerReference'}:
            continue
        rid = node.get(qn('r:id'))
        relation = rels.get(rid or '')
        if not relation or relation['external']:
            continue
        target = relation['target']
        if (re.fullmatch(r'word/(header|footer)\d+\.xml', target)
                and target in archive.namelist() and target not in parts):
            parts.append(target)
    return parts


def relationships(archive: zipfile.ZipFile, part: str) -> dict[str, dict[str, Any]]:
    path = posixpath.join(posixpath.dirname(part), '_rels', posixpath.basename(part) + '.rels')
    if path not in archive.namelist():
        return {}
    root = etree.fromstring(archive.read(path))
    return {item.get('Id'): {
        'target': posixpath.normpath(posixpath.join(posixpath.dirname(part), item.get('Target', ''))).lstrip('/'),
        'external': item.get('TargetMode') == 'External',
        'type': str(item.get('Type') or '').rsplit('/', 1)[-1],
    } for item in root if item.get('Id')}


def effective_children(node: Any) -> list[Any]:
    """Word displays one compatibility branch, not Choice plus its fallback."""
    if local(node) == 'AlternateContent':
        candidates = [child for child in node if local(child) == 'Choice']
        chosen = next((child for child in candidates if any(local(n) in {'t', 'blip', 'imagedata', 'txbxContent'} for n in child.iter())), None)
        if chosen is None:
            chosen = next((child for child in node if local(child) == 'Fallback'), None)
        return [chosen] if chosen is not None else []
    return list(node)


def visible_nodes(node: Any) -> Iterator[Any]:
    if local(node) in {'del', 'moveFrom'}:
        return
    yield node
    for child in effective_children(node):
        yield from visible_nodes(child)


def style_value(style: Any, scope: str, key: str) -> Any:
    seen = set()
    while style is not None and style.style_id not in seen:
        seen.add(style.style_id)
        value = getattr(getattr(style, scope), key)
        if value is not None:
            return value
        style = style.base_style
    return None


def iter_media_references(archive: zipfile.ZipFile, part: str) -> Iterator[dict[str, Any]]:
    """Each image reference exactly once, including tables/textboxes/anchored drawings."""
    root = etree.fromstring(archive.read(part))
    tree = root.getroottree()
    for node in visible_nodes(root):
        if local(node) not in {'blip', 'imagedata'}:
            continue
        rid = node.get(qn('r:embed')) or node.get(qn('r:id')) or node.get(qn('r:link'))
        if not rid:
            continue
        drawing = next((ancestor for ancestor in node.iterancestors() if local(ancestor) in {'drawing', 'pict'}), node)
        yield {'relationship_id': rid, 'drawing': drawing, 'location': tree.getpath(node)}


class OrderedDocxReader:
    def __init__(self, path: str | Any):
        self.archive = zipfile.ZipFile(path)
        self.document = Document(path)
        self.blocks = []
        self.diagnostics = []
        self.media_order = 0
        self._relationships: dict[str, dict[str, dict[str, Any]]] = {}
        self._default_run_format = self._document_default_run_format()
        # Formatting/relationships are semantic input too. Renaming a file does
        # not change identity; changing inherited styles or a linked asset does.
        semantic_parts = sorted(name for name in self.archive.namelist()
                                if name.startswith('word/') and not name.endswith('/'))
        digest = hashlib.sha256()
        for part in semantic_parts:
            digest.update(part.encode() + b'\0' + self.archive.read(part))
        self.source_hash = digest.hexdigest()

    def _document_default_run_format(self) -> dict[str, bool | None]:
        """Read OOXML docDefaults, which python-docx does not expose as run style."""
        result: dict[str, bool | None] = {'bold': None, 'italic': None, 'underline': None}
        styles = self.document.styles.element
        defaults = styles.find('.//' + qn('w:rPrDefault'))
        properties = defaults.find(qn('w:rPr')) if defaults is not None else None
        if properties is None:
            return result
        for key, tag in (('bold', 'b'), ('italic', 'i'), ('underline', 'u')):
            node = properties.find(qn('w:' + tag))
            if node is None:
                continue
            value = str(node.get(qn('w:val'), 'true')).casefold()
            result[key] = value not in _FALSE_VALUES
        return result

    def _part_relationships(self, part: str) -> dict[str, dict[str, Any]]:
        if part not in self._relationships:
            self._relationships[part] = relationships(self.archive, part)
        return self._relationships[part]

    def _block(self, block_id: str) -> dict[str, Any] | None:
        return next((item for item in reversed(self.blocks)
                     if item['block_id'] == block_id), None)

    def _has_descendant_kind(self, block_id: str, kind: str) -> bool:
        owner = self._block(block_id)
        if not owner:
            return False
        pending = list(owner.get('children', []))
        while pending:
            child = self._block(pending.pop())
            if not child:
                continue
            if child['kind'] == kind:
                return True
            pending.extend(child.get('children', []))
        return False

    def add(self, kind, node, part, parent='', **values):
        location = node.getroottree().getpath(node)
        order = len(self.blocks)
        suffix = values.pop('segment', '')
        block_id = 'block_' + hashlib.sha256(f'{self.source_hash}|{part}|{location}|{kind}|{suffix}'.encode()).hexdigest()[:20]
        block = {'block_id': block_id, 'kind': kind, 'document_order': order,
                 'source_part': part, 'location': location, 'parent_id': parent,
                 'container_id': parent, 'children': [], 'visible_text': '', 'runs': [],
                 'alignment': 'left', 'coverage_state': 'PRESERVED', 'diagnostics': [],
                 'region': 'body' if part == 'word/document.xml' else posixpath.basename(part).split('.')[0], **values}
        self.blocks.append(block)
        if parent:
            owner = next((b for b in reversed(self.blocks[:-1]) if b['block_id'] == parent), None)
            if owner:
                owner['children'].append(block_id)
        return block

    def issue(self, block, code, details, lossy=False):
        item = {'code': code, 'severity': 'FAIL' if lossy else 'WARN', 'stage': 'INGESTING',
                'block_id': block['block_id'], 'kind': block['kind'], 'location': block['location'],
                'recoverable': not lossy, 'classification': 'LOSSY' if lossy else 'RECOVERABLE',
                'details': details, 'message': details, 'retryable': False}
        self.diagnostics.append(item)
        block['diagnostics'].append(item)
        if lossy:
            block['coverage_state'] = 'MANUAL_REVIEW_REQUIRED'

    def _descendant_text(self, block: dict[str, Any]) -> str:
        """Aggregate leaf text once while retaining child blocks independently."""
        by_id = {item['block_id']: item for item in self.blocks}
        lines: list[str] = []

        def visit(block_id: str) -> None:
            child = by_id.get(block_id)
            if not child:
                return
            if child.get('children'):
                for nested in child['children']:
                    visit(nested)
            elif str(child.get('visible_text') or '').strip():
                lines.append(str(child['visible_text']))

        for child_id in block.get('children', []):
            visit(child_id)
        return '\n'.join(lines)

    def _relationship_reference(self, node: Any, part: str, parent: str) -> bool:
        """Account for non-image DrawingML/Word relationships instead of dropping them."""
        attributes = [(name, value) for name, value in node.attrib.items()
                      if str(name).startswith('{' + NS_R + '}') and value]
        if not attributes:
            return False
        rels = self._part_relationships(part)
        # Hyperlinks and image relationships are either non-content navigation
        # or handled by image(). Other graphic relationships (charts, SmartArt,
        # embedded packages) cannot be faithfully reconstructed from plain text.
        unresolved: list[tuple[str, dict[str, Any] | None]] = []
        for _name, relationship_id in attributes:
            relation = rels.get(relationship_id)
            if relation and relation.get('type') in {'hyperlink', 'image'}:
                continue
            unresolved.append((relationship_id, relation))
        if not unresolved:
            return False
        relationship_id, relation = unresolved[0]
        block = self.add('UNKNOWN', node, part, parent,
                         relationship_id=relationship_id,
                         relationship_type=str((relation or {}).get('type') or ''),
                         relationship_target=str((relation or {}).get('target') or ''),
                         ooxml_tag=local(node))
        kind = str((relation or {}).get('type') or local(node))
        preview_preserved = kind in {'oleObject', 'package'} and self._has_descendant_kind(parent, 'IMAGE')
        self.issue(block, 'SOURCE_DRAWING_CONTENT_UNSUPPORTED',
                   (f'OOXML {kind} editable data was normalized to its preserved image preview.'
                    if preview_preserved else
                    f'OOXML {kind} content has no lossless text/image representation.'),
                   not preview_preserved)
        return True

    def paragraph(self, node, part, parent):
        paragraph = Paragraph(node, self.document)
        style = paragraph.style
        alignment = paragraph.alignment
        if alignment is None and style:
            alignment = style_value(style, 'paragraph_format', 'alignment')
        align = {1: 'center', 2: 'right', 3: 'justify'}.get(int(alignment or 0), 'left')
        numbering = node.find(qn('w:pPr'))
        numbering = numbering.find(qn('w:numPr')) if numbering is not None else None
        if numbering is None:
            current, seen = style, set()
            while current is not None and current.style_id not in seen:
                seen.add(current.style_id)
                numbering = current.element.find('.//' + qn('w:numPr'))
                if numbering is not None:
                    break
                current = current.base_style
        metadata = {'style_id': node.find(qn('w:pPr')).find(qn('w:pStyle')).get(qn('w:val'))
                    if node.find(qn('w:pPr')) is not None and node.find(qn('w:pPr')).find(qn('w:pStyle')) is not None else '',
                    'style_name': style.name if style else '',
                    'numbering': etree.tostring(numbering, encoding='unicode') if numbering is not None else ''}
        if numbering is not None:
            metadata['numbering_definition'] = self.numbering_definition(numbering)
        runs, segment = [], 0
        def flush():
            nonlocal runs, segment
            if runs:
                self.add('PARAGRAPH', node, part, parent, segment=str(segment), runs=runs,
                         visible_text=''.join(r['text'] for r in runs), alignment=align,
                         list_item=bool(numbering is not None or (style and re.search('list|bullet', style.name, re.I))),
                         style=metadata)
                segment += 1
                runs = []
        def visit(element):
            if local(element) in {'del', 'moveFrom'}:
                flush()
                self.add('UNKNOWN', element, part, parent, coverage_state='IGNORED_DECORATION',
                         ooxml_tag=local(element), reason='Tracked deletion excluded from the final visible document.')
                return
            if local(element) in {'drawing', 'pict', 'object', 'txbxContent'}:
                flush()
                self.walk(element, part, parent)
                return
            if local(element) == 'r':
                run = Run(element, paragraph)
                attrs = {}
                for key in ('bold', 'italic', 'underline'):
                    value = getattr(run, key)
                    if value is None and run.style:
                        value = style_value(run.style, 'font', key)
                    if value is None and style:
                        value = style_value(style, 'font', key)
                    if value is None:
                        value = self._default_run_format[key]
                    attrs[key] = bool(value)
                for child in element:
                    tag = local(child)
                    if tag == 't':
                        runs.append({'text': child.text or '', **attrs})
                    elif tag in {'tab', 'br', 'cr', 'noBreakHyphen', 'softHyphen'}:
                        if tag == 'br' and child.get(qn('w:type')) == 'page':
                            flush(); self.add('PAGE_BREAK', child, part, parent, coverage_state='IGNORED_DECORATION')
                        else:
                            runs.append({'text': {'tab': '\t', 'br': '\n', 'cr': '\n', 'noBreakHyphen': '\u2011', 'softHyphen': '\u00ad'}[tag], **attrs})
                    elif tag != 'rPr':
                        visit(child)
                return
            for child in effective_children(element):
                if local(child) != 'pPr':
                    visit(child)
        visit(node)
        flush()
        if node.find('.//' + qn('w:sectPr')) is not None:
            self.add('SECTION_BREAK', node, part, parent, coverage_state='IGNORED_DECORATION')

    def numbering_definition(self, numbering):
        """Retain real list numbering semantics; do not guess from style names."""
        num = numbering.find(qn('w:numId'))
        level = numbering.find(qn('w:ilvl'))
        num_id = num.get(qn('w:val'), '') if num is not None else ''
        ilvl = level.get(qn('w:val'), '0') if level is not None else '0'
        result = {'num_id': num_id, 'level': ilvl}
        try:
            root = self.document.part.numbering_part.element
        except (KeyError, AttributeError):
            return result
        definition = next((n for n in root.findall(qn('w:num')) if n.get(qn('w:numId')) == num_id), None)
        if definition is None:
            return result
        abstract_ref = definition.find(qn('w:abstractNumId'))
        abstract_id = abstract_ref.get(qn('w:val')) if abstract_ref is not None else ''
        abstract = next((n for n in root.findall(qn('w:abstractNum')) if n.get(qn('w:abstractNumId')) == abstract_id), None)
        properties = next((n for n in abstract.findall(qn('w:lvl')) if n.get(qn('w:ilvl')) == ilvl), None) if abstract is not None else None
        if properties is not None:
            for key, tag in (('format', 'numFmt'), ('text', 'lvlText'), ('start', 'start')):
                value = properties.find(qn('w:' + tag))
                if value is not None:
                    result[key] = value.get(qn('w:val'), '')
        override = next((n for n in definition.findall(qn('w:lvlOverride')) if n.get(qn('w:ilvl')) == ilvl), None)
        if override is not None:
            start = override.find(qn('w:startOverride'))
            if start is not None:
                result['start'] = start.get(qn('w:val'), '')
        return result

    def table(self, node, part, parent):
        grid = node.find(qn('w:tblGrid'))
        grid_columns = len(grid.findall(qn('w:gridCol'))) if grid is not None else 0
        table = self.add('TABLE', node, part, parent, coverage_state='NORMALIZED',
                         rows=[], grid_columns=grid_columns)
        active_merges: dict[int, dict[str, Any]] = {}
        for row_index, row in enumerate(node.findall(qn('w:tr'))):
            row_props = row.find(qn('w:trPr'))
            grid_before = row_props.find(qn('w:gridBefore')) if row_props is not None else None
            try:
                column = max(0, int(grid_before.get(qn('w:val'), '0'))) if grid_before is not None else 0
            except ValueError:
                column = 0
                self.issue(table, 'SOURCE_TABLE_GEOMETRY_INVALID', 'Table row has an invalid grid offset.', True)
            cells: list[dict[str, Any]] = []
            current_merges: dict[int, dict[str, Any]] = {}
            if column:
                cells.append({'cell_id': f'{table["block_id"]}:r{row_index}:c0',
                              'column': 0, 'column_span': column, 'row_span': 1,
                              'blocks': [], 'vertical_merge': '', 'horizontal_merge': '',
                              'visible_text': '', 'omitted': True})
            horizontal_owner: dict[str, Any] | None = None
            for cell in row.findall(qn('w:tc')):
                props = cell.find(qn('w:tcPr'))
                span = props.find(qn('w:gridSpan')) if props is not None else None
                merge = props.find(qn('w:vMerge')) if props is not None else None
                horizontal = props.find(qn('w:hMerge')) if props is not None else None
                try:
                    width = int(span.get(qn('w:val'), '1')) if span is not None else 1
                    if not 1 <= width <= 100:
                        raise ValueError('unbounded span')
                except ValueError:
                    width = 1
                    self.issue(table, 'SOURCE_TABLE_GEOMETRY_INVALID', 'Table cell has an invalid column span.', True)
                vertical_state = ('continue' if merge is not None and
                                  merge.get(qn('w:val'), 'continue') == 'continue'
                                  else 'restart' if merge is not None else '')
                horizontal_state = ('continue' if horizontal is not None and
                                    horizontal.get(qn('w:val'), 'continue') == 'continue'
                                    else 'restart' if horizontal is not None else '')
                item = {'cell_id': f'{table["block_id"]}:r{row_index}:c{column}',
                        'column': column, 'column_span': width, 'row_span': 1,
                        'blocks': [], 'vertical_merge': vertical_state,
                        'horizontal_merge': horizontal_state, 'visible_text': ''}
                first = len(self.blocks)
                for child in cell:
                    if local(child) != 'tcPr':
                        self.walk(child, part, table['block_id'])
                new_blocks = self.blocks[first:]
                item['blocks'] = [b['block_id'] for b in new_blocks if b['parent_id'] == table['block_id']]
                item['visible_text'] = self._descendant_text({'children': item['blocks']})
                has_media = any(b['kind'] == 'IMAGE' for b in new_blocks)
                if vertical_state == 'continue' and (item['visible_text'].strip() or has_media):
                    # Word continuations should be empty. Keeping non-empty
                    # content without a diagnosis would let rendering drop it.
                    self.issue(table, 'SOURCE_TABLE_MERGE_CONTENT_AMBIGUOUS',
                               'A vertically merged continuation cell contains independent content.', True)
                if horizontal_state == 'continue':
                    if horizontal_owner is None:
                        item['horizontal_merge'] = ''
                        self.issue(table, 'SOURCE_TABLE_MERGE_INVALID',
                                   'Horizontal merge has no matching owner to its left.', True)
                    else:
                        horizontal_owner['column_span'] += width
                        if item['visible_text'].strip() or has_media:
                            self.issue(table, 'SOURCE_TABLE_MERGE_CONTENT_AMBIGUOUS',
                                       'A horizontally merged continuation cell contains independent content.', True)
                        if vertical_state:
                            self.issue(table, 'SOURCE_TABLE_MERGE_COMPLEX',
                                       'Legacy horizontal and vertical merge continuations overlap.', True)
                    cells.append(item)
                    column += width
                    continue
                cells.append(item)
                horizontal_owner = item if horizontal_state == 'restart' else None
                column += width

            # Resolve vertical merges after horizontal spans have reached their
            # final width, so a merged rectangle has one unambiguous owner.
            for item in cells:
                if item.get('omitted') or item.get('horizontal_merge') == 'continue':
                    continue
                start = item['column']
                if item['vertical_merge'] == 'continue':
                    owner = active_merges.get(start)
                    if owner is not None and owner['column_span'] == item['column_span']:
                        owner['row_span'] += 1
                        current_merges[start] = owner
                    else:
                        item['vertical_merge'] = ''
                        self.issue(table, 'SOURCE_TABLE_MERGE_INVALID',
                                   'Vertical merge has no matching cell immediately above.', True)
                elif item['vertical_merge'] == 'restart':
                    current_merges[start] = item

            grid_after = row_props.find(qn('w:gridAfter')) if row_props is not None else None
            try:
                trailing = max(0, int(grid_after.get(qn('w:val'), '0'))) if grid_after is not None else 0
            except ValueError:
                trailing = 0
                self.issue(table, 'SOURCE_TABLE_GEOMETRY_INVALID',
                           'Table row has an invalid trailing grid offset.', True)
            if not trailing and grid_columns and column < grid_columns:
                trailing = grid_columns - column
            if trailing:
                cells.append({'cell_id': f'{table["block_id"]}:r{row_index}:c{column}',
                              'column': column, 'column_span': trailing, 'row_span': 1,
                              'blocks': [], 'vertical_merge': '', 'horizontal_merge': '',
                              'visible_text': '', 'omitted': True})
            table['rows'].append({'row_index': row_index, 'cells': cells})
            active_merges = current_merges
        table['visible_text'] = self._descendant_text(table)

    def image(self, node, part, parent):
        rid = node.get(qn('r:embed')) or node.get(qn('r:id')) or node.get(qn('r:link'))
        if not rid:
            return
        image = self.add('IMAGE', node, part, parent, relationship_id=rid, media_order=self.media_order,
                         coverage_state='MEDIA_ASSET')
        self.media_order += 1
        relation = self._part_relationships(part).get(rid)
        if not relation or relation['external'] or relation['target'] not in self.archive.namelist():
            self.issue(image, 'SOURCE_MEDIA_RELATIONSHIP_UNRESOLVED', f'Required image relationship {rid} cannot be resolved inside {part}.', True)
            return
        raw = self.archive.read(relation['target'])
        digest = hashlib.sha256(raw).hexdigest()
        image.update({'asset_id': f'media_{digest[:24]}', 'sha256': digest,
                      'mime_type': mimetypes.guess_type(relation['target'])[0] or 'application/octet-stream',
                      'relationship_type': relation.get('type', ''),
                      'relationship_target': relation['target'],
                      'occurrence_id': f'occ_{self.source_hash[:12]}_{image["media_order"]}_{digest[:10]}',
                      'media_occurrence_ids': [f'occ_{self.source_hash[:12]}_{image["media_order"]}_{digest[:10]}']})
        drawing = next((ancestor for ancestor in node.iterancestors() if local(ancestor) in {'drawing', 'pict'}), node)
        extent = next((n for n in drawing.iter() if local(n) == 'extent'), None)
        for key, attribute in (('width_emu', 'cx'), ('height_emu', 'cy')):
            value = extent.get(attribute, '') if extent is not None else ''
            image[key] = int(value) if value.isdigit() else None
        image['drawing_type'] = next((local(n) for n in drawing.iter()
                                      if local(n) in {'inline', 'anchor'}), '')
        properties = next((n for n in drawing.iter() if local(n) == 'docPr'), None)
        image['alt_text'] = str(properties.get('descr') or '') if properties is not None else ''
        image['title'] = str(properties.get('title') or '') if properties is not None else ''
        crop = next((n for n in drawing.iter() if local(n) == 'srcRect'), None)
        image['crop'] = {}
        if crop is not None:
            try:
                image['crop'] = {key: float(crop.get(key, '0')) / 1000
                                 for key in ('l', 't', 'r', 'b')
                                 if crop.get(key) is not None}
            except ValueError:
                self.issue(image, 'SOURCE_MEDIA_CROP_INVALID',
                           'Image crop geometry is invalid; source bytes and position were preserved.')

    def walk(self, node, part, parent=''):
        tag = local(node)
        if tag in {'del', 'moveFrom'}:
            self.add('UNKNOWN', node, part, parent, coverage_state='IGNORED_DECORATION', ooxml_tag=tag)
        elif tag == 'p':
            self.paragraph(node, part, parent)
        elif tag == 'tbl':
            self.table(node, part, parent)
        elif tag in {'blip', 'imagedata'}:
            self.image(node, part, parent)
        elif tag == 'sectPr':
            self.add('SECTION_BREAK', node, part, parent, coverage_state='IGNORED_DECORATION')
        elif tag in {'drawing', 'pict', 'txbxContent', 'sdt', 'object', 'altChunk'}:
            kind = {'txbxContent': 'TEXTBOX', 'drawing': 'DRAWING', 'pict': 'DRAWING'}.get(tag, 'UNKNOWN')
            block = self.add(kind, node, part, parent, coverage_state='NORMALIZED', ooxml_tag=tag)
            for child in effective_children(node):
                self.walk(child, part, block['block_id'])
            block['visible_text'] = self._descendant_text(block)
            if not block['children']:
                self.issue(block, 'SOURCE_BLOCK_UNRESOLVED', f'{tag} has no extractable text or image representation.', tag in {'object', 'altChunk'})
        elif tag in {'t', 'text'} and (node.text or '').strip():
            text = str(node.text or '')
            block = self.add('UNKNOWN', node, part, parent, visible_text=text,
                             runs=[{'text': text, 'bold': False, 'italic': False, 'underline': False}],
                             coverage_state='NORMALIZED', ooxml_tag=tag)
            self.issue(block, 'SOURCE_BLOCK_NORMALIZED',
                       f'Text from {tag} retained for structural reconstruction.')
        elif self._relationship_reference(node, part, parent):
            pass
        elif tag in {'body', 'document', 'hdr', 'ftr', 'sdtContent'} or len(node):
            before = len(self.blocks)
            for child in effective_children(node):
                if local(child) not in {'sdtPr', 'tcPr', 'tblPr', 'tblGrid', 'rPr', 'pPr', 'docPr'}:
                    self.walk(child, part, parent)
            if len(self.blocks) == before and tag not in {'body', 'document', 'hdr', 'ftr'}:
                text = ''.join(n.text or '' for n in node.iter() if local(n) == 't')
                if text.strip():
                    block = self.add('UNKNOWN', node, part, parent, visible_text=text,
                                     runs=[{'text': text, 'bold': False, 'italic': False, 'underline': False}],
                                     coverage_state='NORMALIZED', ooxml_tag=tag)
                    self.issue(block, 'SOURCE_BLOCK_NORMALIZED', f'Text from {tag} retained for structural reconstruction.')

    def read(self):
        try:
            for part in source_parts(self.archive):
                root = parse_xml(self.archive.read(part))
                self.walk(root, part)
            text_blocks = [block for block in self.blocks
                           if not block.get('children')
                           and block['coverage_state'] != 'IGNORED_DECORATION'
                           and str(block.get('visible_text') or '').strip()]
            for block in self.blocks:
                if block['kind'] != 'IMAGE':
                    continue
                earlier = [item for item in text_blocks
                           if item['source_part'] == block['source_part']
                           and item['document_order'] < block['document_order']]
                later = [item for item in text_blocks
                         if item['source_part'] == block['source_part']
                         and item['document_order'] > block['document_order']]
                block['nearby_text'] = {
                    'before': str(earlier[-1]['visible_text'])[-300:] if earlier else '',
                    'after': str(later[0]['visible_text'])[:300] if later else '',
                }
            counts = Counter(block['coverage_state'] for block in self.blocks)
            coverage = {'state': 'FAIL' if counts['MANUAL_REVIEW_REQUIRED'] else 'PASS', 'total': len(self.blocks),
                        'by_state': dict(counts), 'unresolved_block_ids': [b['block_id'] for b in self.blocks if b['coverage_state'] == 'MANUAL_REVIEW_REQUIRED']}
            text = '\n'.join(str(block['visible_text']) for block in text_blocks)
            return self.blocks, text, self.source_hash, coverage, self.diagnostics
        finally:
            self.archive.close()
