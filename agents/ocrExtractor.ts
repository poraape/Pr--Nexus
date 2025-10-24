/**
 * Runs OCR on an image file buffer using Tesseract.js.
 * @param buffer The ArrayBuffer of the image file.
 * @param lang The language for OCR (defaults to 'por' for Portuguese).
 * @returns A promise that resolves to the extracted text.
 */
export async function runOCRFromImage(buffer: ArrayBuffer, lang = "por"): Promise<string> {
    try {
        const { createWorker } = await import('tesseract.js');
        // NOTE: In a real build, worker paths would be configured locally.
        // In AI Studio, we rely on CDN fallback mechanisms if available.
        const worker = await createWorker(lang);
        const { data } = await worker.recognize(buffer);
        await worker.terminate();
        return data.text;
    } catch (error) {
        console.error('Tesseract OCR failed:', error);
        throw new Error('Falha ao executar OCR na imagem. A biblioteca Tesseract pode não ter sido carregada.');
    }
}