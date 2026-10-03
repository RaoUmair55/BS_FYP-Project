import fs from 'node:fs/promises';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';
const dir='D:/BS_FYP Project/IntegrityFlow/presentation';
const p=await PresentationFile.importPptx(await FileBlob.load(`${dir}/output/IntegrityFlow_Progress_Presentation_Ready.pptx`));
for(let i=0;i<p.slides.items.length;i++) {
 if(process.argv[2] && i !== Number(process.argv[2])-1) continue;
 const blob=await p.export({slide:p.slides.items[i],format:'png',scale:1});
 await fs.writeFile(`${dir}/.build/final-${i+1}.png`,new Uint8Array(await blob.arrayBuffer()));
}
console.log(`Rendered ${p.slides.items.length} final slides`);
