import type { TItem } from '../shared/parse';

/** Lê os textos posicionados de cada página com o pdf.js (carregado só quando alguém importa). */
export async function textosDoPdf(file: File): Promise<TItem[][]> {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.js?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const paginas: TItem[][] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    paginas.push(
      tc.items
        .filter((i: any) => typeof i.str === 'string')
        .map((i: any) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })),
    );
  }
  await doc.destroy();
  return paginas;
}
