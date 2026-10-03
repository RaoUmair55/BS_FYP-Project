"""Add native click-controlled PowerPoint fades without rasterizing content."""
import copy
import json
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

BASE = Path(__file__).parent
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
ET.register_namespace('p', P)
ET.register_namespace('a', A)
ET.register_namespace('r', R)
ns = {'p': P}

with zipfile.ZipFile(BASE.parent / 'output/IntegrityFlow_Animated_Progress_Modules.pptx') as old:
    template = ET.fromstring(old.read('ppt/slides/slide6.xml')).find('p:timing', ns)
    root_template = template.find('p:tnLst/p:par/p:cTn', ns)
    seq_template = root_template.find('p:childTnLst/p:seq', ns)
    group_template = seq_template.find('p:cTn/p:childTnLst/p:par', ns)
    effect_template = group_template.find('p:cTn/p:childTnLst/p:par', ns)

report = []
with zipfile.ZipFile(BASE / 'draft.pptx') as source, zipfile.ZipFile(BASE / 'animated-draft.pptx', 'w', zipfile.ZIP_DEFLATED) as target:
    for item in source.infolist():
        data = source.read(item.filename)
        if re.fullmatch(r'ppt/slides/slide\d+\.xml', item.filename):
            slide = ET.fromstring(data)
            for tag in ('transition', 'timing'):
                old = slide.find(f'p:{tag}', ns)
                if old is not None:
                    slide.remove(old)
            transition = ET.Element(f'{{{P}}}transition', {'spd': 'med', 'advClick': '1'})
            ET.SubElement(transition, f'{{{P}}}fade')
            slide.append(transition)
            groups = {}
            for nv in slide.findall('.//p:cNvPr', ns):
                match = re.fullmatch(r'reveal-(\d+)', nv.get('name', ''))
                if match:
                    groups.setdefault(int(match[1]), []).append(nv.get('id'))
            if groups:
                timing = copy.deepcopy(template)
                seq = timing.find('p:tnLst/p:par/p:cTn/p:childTnLst/p:seq', ns)
                children = seq.find('p:cTn/p:childTnLst', ns)
                children.clear()
                for group_id, ids in sorted(groups.items()):
                    group = copy.deepcopy(group_template)
                    effects = group.find('p:cTn/p:childTnLst', ns)
                    effects.clear()
                    for shape_id in ids:
                        effect = copy.deepcopy(effect_template)
                        effect.find('p:cTn', ns).set('grpId', str(group_id))
                        for shape_target in effect.findall('.//p:spTgt', ns):
                            shape_target.set('spid', shape_id)
                        effects.append(effect)
                    children.append(group)
                for node_id, node in enumerate(timing.findall('.//p:cTn', ns), 1):
                    node.set('id', str(node_id))
                # Build explicit targets for the authored reveal shapes only.
                build_list = timing.find('p:bldLst', ns)
                if build_list is not None:
                    build_list.clear()
                    for group_id, ids in sorted(groups.items()):
                        for shape_id in ids:
                            ET.SubElement(build_list, f'{{{P}}}bldP', {'spid': shape_id, 'grpId': str(group_id), 'uiExpand': '1'})
                slide.append(timing)
                targets = {x.get('id') for x in slide.findall('.//p:cNvPr', ns)}
                assert all(x.get('spid') in targets for x in timing.findall('.//p:spTgt', ns))
            report.append({'slide': item.filename, 'click_groups': len(groups), 'animated_objects': sum(map(len, groups.values()))})
            data = ET.tostring(slide, encoding='utf-8', xml_declaration=True)
        target.writestr(item, data)
(BASE / 'animation-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(f'Animated {len(report)} slides, {sum(x["click_groups"] for x in report)} click groups')
