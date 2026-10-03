import fs from 'node:fs/promises';
import path from 'node:path';
import { finalizePresentation } from 'file:///C:/Users/Rao%20Umair/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations/container_tools/artifact_tool_utils.mjs';
const root='D:/BS_FYP Project/IntegrityFlow';
const skill='C:/Users/Rao Umair/.codex/plugins/cache/openai-primary-runtime/presentations/26.909.12148/skills/presentations';
const dir=path.join(root,'presentation/.build-polished');
const result=await finalizePresentation({
 workspaceDir:root,candidatePath:path.join(dir,'animated-draft.pptx'),
 finalPath:path.join(root,'presentation/output/IntegrityFlow_Panel_Animated_2026.pptx'),
 pythonExecutable:'C:/Users/Rao Umair/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',
 integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
 layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
 layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...[5,13,21].flatMap(n=>['--require-native-table-slide',String(n)])],
 explicitTotalSlideCount:22,requiredNativeTableOwnerSlides:[5,13,21],requiredNativeChartOwnerSlides:[11],
 materializeLiteralChartWorkbooks:true,
 fontPolicy:JSON.parse(await fs.readFile(path.join(dir,'font-policy.json'),'utf8')),
 verifyArtifactToolImport:true,receiptPath:path.join(dir,'validation.json'),
});
console.log(JSON.stringify(result,null,2));
