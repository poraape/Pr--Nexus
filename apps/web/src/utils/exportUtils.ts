import dayjs from 'dayjs';
import type { AuditReport, AuditedDocument } from '../types';

// --- Helper Functions ---

const saveAs = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

const getChartImages = async (element: HTMLElement): Promise<Map<HTMLElement, string>> => {
    const { default: html2canvas } = await import('html2canvas');
    const chartContainers = element.querySelectorAll('[data-chart-container="true"]');
    const imageMap = new Map<HTMLElement, string>();
    for (const container of Array.from(chartContainers)) {
        try {
            const canvas = await html2canvas(container as HTMLElement, {
                backgroundColor: '#1f2937', // bg-gray-800
                scale: 2,
                logging: false,
                useCORS: true,
            });
            imageMap.set(container as HTMLElement, canvas.toDataURL('image/png'));
        } catch (error) {
            console.error("Error generating canvas for chart:", error);
        }
    }
    return imageMap;
};

// --- Export Functions ---

export const exportToJson = async (report: AuditReport, filename: string) => {
    const jsonContent = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    saveAs(blob, `${filename}.json`);
};

export const exportToXlsx = async (report: AuditReport, filename: string) => {
    const { utils, writeFile } = await import('xlsx');
    const wb = utils.book_new();

    // Summary Sheet
    const summaryData = [
        ['Título', report.summary.title],
        ['Resumo', report.summary.summary],
        [],
        ['Métricas Chave'],
        ['Métrica', 'Valor', 'Insight'],
        ...report.summary.keyMetrics.map(m => [m.metric, m.value, m.insight]),
        [],
        ['Insights Acionáveis'],
        ...report.summary.actionableInsights.map(i => [i]),
        [],
        ['Recomendações Estratégicas'],
        ...(report.summary.strategicRecommendations || []).map(r => [r])
    ];
    const wsSummary = utils.aoa_to_sheet(summaryData);
    utils.book_append_sheet(wb, wsSummary, 'Resumo Executivo');

    // Document Details Sheet
    const docDetailsData = report.documents.flatMap(d => {
        if (!d.doc.data || d.doc.data.length === 0) {
            // FIX: Added 'Classificação' to ensure a consistent object shape, resolving the type error.
            return [{ 
                Documento: d.doc.name, 
                Status: d.status, 
                Classificação: d.classification?.operationType || 'N/A',
                "Nome Produto": "N/A - Sem itens" 
            }];
        }
        return d.doc.data.map(item => ({
            Documento: d.doc.name,
            Status: d.status,
            Classificação: d.classification?.operationType,
            ...item
        }));
    });
    if(docDetailsData.length > 0) {
        const wsDocs = utils.json_to_sheet(docDetailsData);
        utils.book_append_sheet(wb, wsDocs, 'Detalhes dos Itens');
    }

    // Inconsistencies Sheet
    const inconsistenciesData = report.documents.flatMap(d =>
        d.inconsistencies.map(inc => ({
            Documento: d.doc.name,
            Severidade: inc.severity,
            Código: inc.code,
            Mensagem: inc.message,
            Explicação: inc.explanation,
        }))
    );
    if(inconsistenciesData.length > 0) {
        const wsInconsistencies = utils.json_to_sheet(inconsistenciesData);
        utils.book_append_sheet(wb, wsInconsistencies, 'Inconsistências');
    }

    writeFile(wb, `${filename}.xlsx`);
};

export const exportToMarkdown = async (element: HTMLElement, filename: string) => {
    let markdown = '';
    
    element.querySelectorAll('h2, h3, h4, p, li').forEach(el => {
        const tagName = el.tagName.toLowerCase();
        const text = (el as HTMLElement).innerText || '';

        if (tagName === 'h2' && text.match(/^\d\./)) return; // Skip step headers like "1. Upload"
        if (tagName === 'h2') markdown += `## ${text}\n\n`;
        else if (tagName === 'h3') markdown += `### ${text}\n\n`;
        else if (tagName === 'h4') markdown += `#### ${text}\n\n`;
        else if (tagName === 'p') markdown += `${text}\n\n`;
        else if (tagName === 'li') markdown += `* ${text}\n`;
    });

    const blob = new Blob([markdown.trim()], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `${filename}.md`);
};

export const exportToHtml = async (element: HTMLElement, filename: string, title: string) => {
    const contentClone = element.cloneNode(true) as HTMLElement;
    
    // Remove file upload and progress tracker from clone
    contentClone.querySelector('.bg-gray-800.p-6.rounded-lg.shadow-lg')?.remove();
    contentClone.querySelector('.bg-gray-800.p-6.rounded-lg.shadow-lg.animate-fade-in')?.remove();

    const imageMap = await getChartImages(element);
    
    const clonedCharts = contentClone.querySelectorAll('[data-chart-container="true"]');
    const originalCharts = Array.from(element.querySelectorAll('[data-chart-container="true"]'));

    clonedCharts.forEach((clonedChart, index) => {
        const originalChart = originalCharts[index] as HTMLElement;
        const imgDataUrl = imageMap.get(originalChart);
        if (imgDataUrl) {
            const img = document.createElement('img');
            img.src = imgDataUrl;
            img.style.width = '100%';
            img.style.maxWidth = '500px';
            img.style.marginTop = '1rem';
            img.style.border = '1px solid #4b5563';
            img.style.borderRadius = '8px';
            clonedChart.replaceWith(img);
        }
    });

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #e5e7eb; background-color: #111827; max-width: 800px; margin: 20px auto; padding: 20px; }
                h1, h2, h3, h4 { color: #ffffff; border-bottom: 1px solid #4b5563; padding-bottom: 8px; }
                h1 { font-size: 2em; } h2 { font-size: 1.5em; } h3 { font-size: 1.25em; }
                .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; }
                .metric { background-color: #1f2937; padding: 1rem; border-radius: 8px; }
                .chat-message { padding: 1rem; border-radius: 8px; margin-bottom: 1rem; max-width: 80%; }
                .user-message { background-color: #2563eb; color: white; margin-left: auto; border-bottom-right-radius: 0; }
                .ai-message { background-color: #374151; color: #d1d5db; border-bottom-left-radius: 0; }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            ${contentClone.innerHTML}
        </body>
        </html>
    `;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    saveAs(blob, `${filename}.html`);
};

export const exportToPdf = async (element: HTMLElement, filename: string, title: string) => {
    const pdfMake = await import('pdfmake/build/pdfmake');
    const pdfFonts = await import('pdfmake/build/vfs_fonts');
    pdfMake.vfs = pdfFonts.pdfMake.vfs;
    
    const today = dayjs().format('DD/MM/YYYY');
    const imageMap = await getChartImages(element);

    const titlePage = {
        stack: [
            { text: title, style: 'mainTitle', alignment: 'center' },
            { text: 'Relatório de Análise Fiscal', style: 'subtitle', alignment: 'center' },
            { text: `\n\nGerado em: ${today}`, style: 'meta', alignment: 'center' },
            { text: 'Assinado por: Nexus QuantumI2A2', style: 'meta', alignment: 'center' },
        ],
        // Trick to vertically center content
        absolutePosition: { x: 40, y: 250 },
    };
    
    const content: any[] = [titlePage, { text: '', pageBreak: 'after' }];

    const parseNode = (node: ChildNode) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return { text: node.textContent || '' };
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return null;

        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();
        
        // Skip non-exportable content
        if (el.closest('.bg-gray-800.p-6.rounded-lg.shadow-lg')) {
           const h2 = el.querySelector('h2');
           if (h2 && h2.innerText.startsWith('1.')) return null;
        }

        if (el.getAttribute('data-export-title') === '') {
            return null; // Skip main title from body as it is on the cover page
        }

        if (el.getAttribute('data-chart-container') === 'true' && imageMap.has(el)) {
            return { image: imageMap.get(el)!, width: 500, style: 'chart' };
        }
        
        const children: any[] = [];
        el.childNodes.forEach(child => {
            const parsedChild = parseNode(child);
            if (parsedChild) children.push(parsedChild);
        });

        switch (tagName) {
            case 'h2':
                if (el.innerText.match(/^\d\./)) return null;
                return { text: el.innerText, style: 'h2' };
            case 'h3': return { text: el.innerText, style: 'h3' };
            case 'h4': return { text: el.innerText, style: 'h4' };
            case 'p': return { text: el.innerText, style: 'paragraph' };
            case 'li': return { text: el.innerText };
            case 'ul': return { ul: children, style: 'list' };
            case 'strong': return { text: el.innerText, bold: true };
            case 'div':
                if (el.classList.contains('prose')) { // Chat message content
                    return { text: el.innerText, style: 'paragraph' };
                }
                return children.length === 1 ? children[0] : { stack: children };
            default:
                return children.length > 0 ? { stack: children } : null;
        }
    };
    
    element.childNodes.forEach(node => {
        const parsed = parseNode(node);
        if (parsed) content.push(parsed);
    });

    const docDefinition = {
        content,
        styles: {
            mainTitle: { fontSize: 28, bold: true, margin: [0, 0, 0, 10] },
            subtitle: { fontSize: 16, italics: true, margin: [0, 0, 0, 20] },
            meta: { fontSize: 10, color: '#888888', margin: [0, 2, 0, 2]},
            header: { fontSize: 22, bold: true, margin: [0, 0, 0, 10] },
            h2: { fontSize: 18, bold: true, margin: [0, 15, 0, 5] },
            h3: { fontSize: 16, bold: true, margin: [0, 10, 0, 5] },
            h4: { fontSize: 14, bold: true, margin: [0, 10, 0, 5] },
            paragraph: { fontSize: 10, margin: [0, 5, 0, 5] },
            list: { margin: [10, 5, 0, 5] },
            chart: { margin: [0, 10, 0, 10], alignment: 'center' },
        },
        defaultStyle: {
            fontSize: 10,
        }
    };

    pdfMake.createPdf(docDefinition).download(`${filename}.pdf`);
};

export const exportToDocx = async (element: HTMLElement, filename:string, title: string) => {
    const docx = await import('docx');
    const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, AlignmentType, PageBreak } = docx;
    
    const today = dayjs().format('DD/MM/YYYY');
    const imageMap = await getChartImages(element);
    const imageBuffers = new Map<HTMLElement, ArrayBuffer>();
    for (const [el, dataUrl] of imageMap.entries()) {
        const res = await fetch(dataUrl);
        imageBuffers.set(el, await res.arrayBuffer());
    }

    const parseNodeToDocx = (node: Node): any[] => {
        if (node.nodeType === Node.TEXT_NODE) {
            return [new TextRun(node.textContent || '')];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return [];

        const el = node as HTMLElement;

        // Skip non-exportable content
        if (el.closest('.bg-gray-800.p-6.rounded-lg.shadow-lg')) {
           const h2 = el.querySelector('h2');
           if (h2 && h2.innerText.startsWith('1.')) return [];
        }

        if (el.getAttribute('data-export-title') === '') {
            return []; // Skip main title from body
        }

        let children: any[] = [];
        el.childNodes.forEach(child => {
            children.push(...parseNodeToDocx(child));
        });

        const tagName = el.tagName.toLowerCase();
        
        if (el.getAttribute('data-chart-container') === 'true' && imageBuffers.has(el)) {
            return [new Paragraph({
                children: [new ImageRun({
                    data: imageBuffers.get(el)!,
                    transformation: { width: 500, height: 280 },
                })]
            })];
        }

        switch (tagName) {
            case 'h2': 
                if (el.innerText.match(/^\d\./)) return [];
                return [new Paragraph({ heading: HeadingLevel.HEADING_2, children })];
            case 'h3': return [new Paragraph({ heading: HeadingLevel.HEADING_3, children })];
            case 'h4': return [new Paragraph({ heading: HeadingLevel.HEADING_4, children })];
            case 'p': return [new Paragraph({ children })];
            case 'li': return [new Paragraph({ bullet: { level: 0 }, children })];
            case 'strong':
            case 'b':
                children.forEach(c => { if(c.options) c.options.bold = true; });
                return children;
            default:
                // Handle divs that might contain paragraphs
                 if (children.some(c => c instanceof Paragraph)) return children;
                 // Handle simple text divs as paragraphs
                 if (children.every(c => c instanceof TextRun)) return [new Paragraph({ children })];
                return children;
        }
    };
    
    const titlePage = [
        new Paragraph({
            children: [new TextRun({ text: title, size: 56, bold: true })],
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 }
        }),
        new Paragraph({
            children: [new TextRun({ text: 'Relatório de Análise Fiscal', size: 28, italics: true })],
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }),
        new Paragraph({
            children: [new TextRun({ text: `Gerado em: ${today}`, size: 22 })],
            alignment: AlignmentType.CENTER,
        }),
         new Paragraph({
            children: [new TextRun({ text: 'Assinado por: Nexus QuantumI2A2', size: 22 })],
            alignment: AlignmentType.CENTER,
        }),
        new Paragraph({ children: [new PageBreak()] }),
    ];
    
    const docChildren: any[] = [...titlePage];
    element.childNodes.forEach(node => {
        docChildren.push(...parseNodeToDocx(node));
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: docChildren.flat(),
        }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
};