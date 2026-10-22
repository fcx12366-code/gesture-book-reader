import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const output = new URL('../.test-data/', import.meta.url);
await mkdir(output, { recursive: true });

async function makePdf(filename, count, mixed = false) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Reader QA: ${filename}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let number = 1; number <= count; number++) {
    const size = mixed && number === 4 ? [842, 595]
      : mixed && number === 7 ? [420, 595]
        : mixed && number === 10 ? [700, 900] : [595, 842];
    const page = doc.addPage(size);
    page.drawRectangle({ x: 0, y: 0, width: size[0], height: size[1], color: number % 2 ? rgb(.94, .96, 1) : rgb(1, .96, .91) });
    page.drawText(number === 1 ? 'PDF READER / COVER' : `PAGE ${number}`, { x: 45, y: size[1] - 85, size: 27, font });
    page.drawText(`${filename} | ${number} / ${count} | ${size[0]} x ${size[1]}`, { x: 45, y: size[1] - 125, size: 13, font });
    page.drawText(number % 2 ? 'ODD / RIGHT PAGE' : 'EVEN / LEFT PAGE', { x: 45, y: 65, size: 17, font });
    for (let line = 0; line < 15; line++) {
      page.drawText(`Line ${line + 1}: Local PDF rendering, zoom and page alignment check.`, { x: 45, y: size[1] - 170 - line * 21, size: 10, font });
    }
  }
  await writeFile(new URL(filename, output), await doc.save());
}

await makePdf('mixed-12.pdf', 12, true);
await makePdf('odd-11.pdf', 11);
await makePdf('long-120.pdf', 120);
await makePdf('single.pdf', 1);
await writeFile(new URL('broken.pdf', output), '%PDF-1.7\nThis deliberately corrupted fixture has no cross-reference or catalog.');
await writeFile(new URL('not-a-pdf.txt', output), 'This file is deliberately not a PDF.');
if (process.argv.includes('--encrypted')) {
  const result = spawnSync(process.env.QA_PYTHON || 'python', [fileURLToPath(new URL('../tests/make-encrypted.py', import.meta.url))], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Encrypted fixture needs Python and pypdf. Install pypdf, then rerun npm run fixtures -- --encrypted.');
}
console.log(`Created PDF fixtures in ${fileURLToPath(output)}`);
