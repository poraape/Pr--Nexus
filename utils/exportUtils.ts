import dayjs from 'dayjs';
import type {
    AuditReport,
    AuditedDocument,
    AccountingEntry,
    AIDrivenInsight,
    DeterministicCrossValidationResult,
    CrossValidationResult,
} from '../types';

type HtmlExportTarget = HTMLElement;

const saveAs = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
};

const escapeAttribute = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

const cleanText = (value: string | undefined | null): string => (value ?? '').trim();

const stripInvisible = (value: string): string =>
    value.replace(/\s+/g, ' ').trim();

const SELECTORS_TO_REMOVE = [
    '.bg-gray-800.p-6.rounded-lg.shadow-lg',
    '.bg-gray-800.p-6.rounded-lg.shadow-lg.animate-fade-in',
    '[data-export-ignore="true"]',
];

const shouldSkipSection = (element: HTMLElement): boolean => {
    if (element.getAttribute('data-export-title') === '') {
        return true;
    }
    const stepHeader = element.querySelector('h2');
    return (
        !!element.closest('.bg-gray-800.p-6.rounded-lg.shadow-lg') &&
        !!stepHeader &&
        /^\d+\./.test(stepHeader.innerText)
    );
};

const getChartImages = async (root: HTMLElement): Promise<Map<HTMLElement, HTMLImageElement>> => {
    const { default: html2canvas } = await import('html2canvas');
    const map = new Map<HTMLElement, HTMLImageElement>();
    const containers = root.querySelectorAll('[data-chart-container="true"]');

    for (const container of Array.from(containers)) {
        try {
            const canvas = await html2canvas(container as HTMLElement, {
                backgroundColor: '#1f2937',
                logging: false,
                scale: 2,
                useCORS: true,
            });
            const img = new Image();
            img.src = canvas.toDataURL('image/png');
            map.set(container as HTMLElement, img);
        } catch (error) {
            console.warn('Falha ao rasterizar gr\u00e1fico para exporta\u00e7\u00e3o.', error);
        }
    }
    return map;
};

const normaliseInsightSeverity = (insight: AIDrivenInsight): string =>
    insight.severity ?? 'INFO';

const normaliseAccountingEntry = (entry: AccountingEntry): Record<string, string | number> => ({
    Documento: entry.docName,
    Conta: entry.account,
    Tipo: entry.type,
    Valor: entry.value,
});

const packDocuments = (report: AuditReport): Record<string, unknown>[] => {
    const rows: Record<string, unknown>[] = [];
    report.documents.forEach((doc: AuditedDocument) => {
        if (!doc.doc.data || doc.doc.data.length === 0) {
            rows.push({
                Documento: doc.doc.name,
                Status: doc.status,
                Classificacao: doc.classification?.operationType ?? 'N/A',
                Item: 'Sem itens',
            });
            return;
        }
        doc.doc.data.forEach(item => {
            const flattened: Record<string, unknown> = {
                Documento: doc.doc.name,
                Status: doc.status,
                Classificacao: doc.classification?.operationType ?? 'N/A',
            };
            Object.entries(item).forEach(([key, value]) => {
                flattened[key] = value ?? '';
            });
            rows.push(flattened);
        });
    });
    return rows;
};

const packInconsistencies = (report: AuditReport) =>
    report.documents.flatMap(doc =>
        doc.inconsistencies.map(inc => ({
            Documento: doc.doc.name,
            Severidade: inc.severity,
            Codigo: inc.code,
            Mensagem: inc.message,
            Explicacao: inc.explanation,
        })),
    );

const packDeterministicCrossValidation = (items: DeterministicCrossValidationResult[] | undefined) =>
    (items ?? []).flatMap(result =>
        result.discrepancies.map(discrepancy => ({
            ChaveComparacao: result.comparisonKey,
            Atributo: result.attribute,
            Descricao: result.description,
            Severidade: result.severity,
            ValorA: discrepancy.valueA,
            DocumentoA: JSON.stringify(discrepancy.docA),
            ValorB: discrepancy.valueB,
            DocumentoB: JSON.stringify(discrepancy.docB),
        })),
    );

const packCrossValidation = (items: CrossValidationResult[] | undefined) =>
    (items ?? []).map(result => ({
        Atributo: result.attribute,
        Observacao: result.observation,
        Documentos: (result.documents ?? []).map(doc => JSON.stringify(doc)).join('; '),
    }));

const packInsights = (insights: AIDrivenInsight[] | undefined) =>
    (insights ?? []).map(insight => ({
        Categoria: insight.category,
        Severidade: normaliseInsightSeverity(insight),
        Descricao: insight.description,
        Evidencias: (insight.evidence ?? []).join('; '),
    }));

export const exportToJson = async (report: AuditReport, filename: string) => {
    const blob = new Blob([JSON.stringify(report, null, 2)], {
        type: 'application/json;charset=utf-8',
    });
    saveAs(blob, `${filename}.json`);
};

export const exportToXlsx = async (report: AuditReport, filename: string) => {
    const { utils, writeFile } = await import('xlsx');
    const workbook = utils.book_new();

    const summary = report.summary ?? {
        title: 'Relatorio Fiscal',
        summary: '',
        keyMetrics: [],
        actionableInsights: [],
        strategicRecommendations: [],
    };

    const summarySheet = utils.aoa_to_sheet([
        ['T\u00edtulo', summary.title ?? ''],
        ['Resumo', summary.summary ?? ''],
        [],
        ['M\u00e9tricas Chave'],
        ['M\u00e9trica', 'Valor', 'Insight'],
        ...(summary.keyMetrics ?? []).map(metric => [
            metric.metric,
            metric.value,
            metric.insight,
        ]),
        [],
        ['Insights Acion\u00e1veis'],
        ...((summary.actionableInsights ?? []).map(item => [item])),
        [],
        ['Recomenda\u00e7\u00f5es Estrat\u00e9gicas'],
        ...((summary.strategicRecommendations ?? []).map(item => [item])),
    ]);
    utils.book_append_sheet(workbook, summarySheet, 'Resumo');

    const docsSheetData = packDocuments(report);
    if (docsSheetData.length > 0) {
        utils.book_append_sheet(workbook, utils.json_to_sheet(docsSheetData), 'Documentos');
    }

    const inconsistencies = packInconsistencies(report);
    if (inconsistencies.length > 0) {
        utils.book_append_sheet(
            workbook,
            utils.json_to_sheet(inconsistencies),
            'Inconsistencias',
        );
    }

    const accounting = (report.accountingEntries ?? []).map(normaliseAccountingEntry);
    if (accounting.length > 0) {
        utils.book_append_sheet(
            workbook,
            utils.json_to_sheet(accounting),
            'Lancamentos',
        );
    }

    const aiInsights = packInsights(report.aiDrivenInsights);
    if (aiInsights.length > 0) {
        utils.book_append_sheet(workbook, utils.json_to_sheet(aiInsights), 'Insights IA');
    }

    const aiCrossValidation = packCrossValidation(report.crossValidationResults);
    if (aiCrossValidation.length > 0) {
        utils.book_append_sheet(workbook, utils.json_to_sheet(aiCrossValidation), 'Validador IA');
    }

    const deterministicCv = packDeterministicCrossValidation(report.deterministicCrossValidation);
    if (deterministicCv.length > 0) {
        utils.book_append_sheet(
            workbook,
            utils.json_to_sheet(deterministicCv),
            'Validador Deterministico',
        );
    }

    writeFile(workbook, `${filename}.xlsx`);
};

export const exportToMarkdown = async (element: HtmlExportTarget, filename: string) => {
    const lines: string[] = [];
    element.querySelectorAll('h1, h2, h3, h4, p, li').forEach(node => {
        const el = node as HTMLElement;
        if (shouldSkipSection(el)) {
            return;
        }
        const text = cleanText(el.innerText);
        if (!text) {
            return;
        }
        switch (el.tagName.toLowerCase()) {
            case 'h1':
                lines.push(`# ${text}`);
                break;
            case 'h2':
                if (!/^\d+\./.test(text)) {
                    lines.push(`## ${text}`);
                }
                break;
            case 'h3':
                lines.push(`### ${text}`);
                break;
            case 'h4':
                lines.push(`#### ${text}`);
                break;
            case 'li':
                lines.push(`- ${text}`);
                break;
            default:
                lines.push(text);
                break;
        }
        if (['p', 'h1', 'h2', 'h3', 'h4'].includes(el.tagName.toLowerCase())) {
            lines.push('');
        }
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    saveAs(blob, `${filename}.md`);
};

export const exportToHtml = async (
    element: HtmlExportTarget,
    filename: string,
    title: string,
) => {
    const clone = element.cloneNode(true) as HTMLElement;
    SELECTORS_TO_REMOVE.forEach(selector => clone.querySelector(selector)?.remove());
    const chartImages = await getChartImages(element);
    const originalCharts = Array.from(element.querySelectorAll('[data-chart-container="true"]'));
    const clonedCharts = clone.querySelectorAll('[data-chart-container="true"]');

    clonedCharts.forEach((chart, index) => {
        const original = originalCharts[index] as HTMLElement;
        const img = chartImages.get(original);
        if (img) {
            img.style.maxWidth = '520px';
            img.style.width = '100%';
            img.style.border = '1px solid #4b5563';
            img.style.borderRadius = '8px';
            chart.replaceWith(img);
        }
    });

    const html = `<!DOCTYPE html>
<html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>${escapeAttribute(title)}</title>
        <style>
            :root { color-scheme: dark; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #e2e8f0; max-width: 960px; margin: 32px auto; padding: 32px; }
            h1, h2, h3, h4 { color: #f8fafc; border-bottom: 1px solid #334155; padding-bottom: 8px; margin-top: 32px; }
            section, article, div { margin-bottom: 16px; }
            table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px; }
            th, td { border: 1px solid #334155; padding: 8px 12px; text-align: left; }
            th { background: #1f2937; }
            img { margin-top: 16px; }
        </style>
    </head>
    <body>
        <h1>${escapeAttribute(title)}</h1>
        ${clone.innerHTML}
    </body>
</html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    saveAs(blob, `${filename}.html`);
};

const ensurePdfFonts = async (pdfMake: any) => {
    const pdfFontsModule = await import('pdfmake/build/vfs_fonts');
    const fonts: any = pdfFontsModule.default || pdfFontsModule;
    if (fonts.pdfMake?.vfs) {
        pdfMake.vfs = fonts.pdfMake.vfs;
    } else if (fonts.vfs) {
        pdfMake.vfs = fonts.vfs;
    } else {
        throw new Error('N\u00e3o foi poss\u00edvel carregar as fontes do pdfmake.');
    }
};

export const exportToPdf = async (
    element: HtmlExportTarget,
    filename: string,
    title: string,
) => {
    const pdfMakeModule = await import('pdfmake/build/pdfmake');
    const pdfMake: any = pdfMakeModule.default || pdfMakeModule;
    await ensurePdfFonts(pdfMake);

    const chartImages = await getChartImages(element);
    const today = dayjs().format('DD/MM/YYYY');

    const parseNode = (node: ChildNode): any => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = stripInvisible(node.textContent ?? '');
            return text ? { text } : null;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return null;
        }

        const el = node as HTMLElement;
        if (shouldSkipSection(el)) {
            return null;
        }

        if (el.getAttribute('data-chart-container') === 'true') {
            const img = chartImages.get(el);
            if (img) {
                return { image: img.src, width: 520, margin: [0, 12, 0, 12] };
            }
        }

        const children: any[] = [];
        el.childNodes.forEach(child => {
            const parsed = parseNode(child);
            if (parsed) {
                children.push(parsed);
            }
        });

        const tag = el.tagName.toLowerCase();
        switch (tag) {
            case 'h2':
                if (/^\d+\./.test(el.innerText)) return null;
                return { text: cleanText(el.innerText), style: 'h2' };
            case 'h3':
                return { text: cleanText(el.innerText), style: 'h3' };
            case 'h4':
                return { text: cleanText(el.innerText), style: 'h4' };
            case 'p':
                return { text: cleanText(el.innerText), style: 'paragraph' };
            case 'li':
                return cleanText(el.innerText);
            case 'ul':
                return { ul: children.filter(Boolean), style: 'list' };
            case 'table':
            case 'thead':
            case 'tbody':
                return null;
            default:
                return children.length === 1 ? children[0] : { stack: children };
        }
    };

    const content: any[] = [
        {
            stack: [
                { text: title, style: 'title' },
                { text: 'Relat\u00f3rio de An\u00e1lise Fiscal', style: 'subtitle' },
                { text: `Gerado em ${today}`, style: 'meta' },
            ],
            margin: [0, 160, 0, 40],
        },
        { text: '', pageBreak: 'after' },
    ];

    element.childNodes.forEach(node => {
        const parsed = parseNode(node);
        if (parsed) {
            content.push(parsed);
        }
    });

    const definition = {
        content,
        styles: {
            title: { fontSize: 24, bold: true, alignment: 'center', color: '#22d3ee' },
            subtitle: { fontSize: 16, italics: true, alignment: 'center', margin: [0, 8, 0, 8] },
            meta: { fontSize: 10, color: '#94a3b8', alignment: 'center' },
            h2: { fontSize: 18, bold: true, margin: [0, 18, 0, 6] },
            h3: { fontSize: 16, bold: true, margin: [0, 12, 0, 6] },
            h4: { fontSize: 14, bold: true, margin: [0, 10, 0, 6] },
            paragraph: { fontSize: 10, margin: [0, 4, 0, 8] },
            list: { margin: [12, 4, 0, 8], fontSize: 10 },
        },
        defaultStyle: { fontSize: 10 },
    };

    pdfMake.createPdf(definition).download(`${filename}.pdf`);
};

export const exportToDocx = async (
    element: HtmlExportTarget,
    filename: string,
    title: string,
) => {
    const docx = await import('docx');
    const {
        AlignmentType,
        Document,
        HeadingLevel,
        ImageRun,
        Paragraph,
        Packer,
        TextRun,
        PageBreak,
    } = docx;

    const chartImages = await getChartImages(element);
    const imageBuffers = new Map<HTMLElement, ArrayBuffer>();
    for (const [el, img] of chartImages.entries()) {
        const response = await fetch(img.src);
        imageBuffers.set(el, await response.arrayBuffer());
    }

    const parseNode = (node: ChildNode): any[] => {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = cleanText(node.textContent ?? '');
            return text ? [new TextRun(text)] : [];
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return [];
        }

        const el = node as HTMLElement;
        if (shouldSkipSection(el)) {
            return [];
        }

        if (el.getAttribute('data-chart-container') === 'true' && imageBuffers.has(el)) {
            return [
                new Paragraph({
                    children: [
                        new ImageRun({
                            data: imageBuffers.get(el)!,
                            transformation: { width: 500, height: 280 },
                        }),
                    ],
                    spacing: { after: 200 },
                }),
            ];
        }

        const children = Array.from(el.childNodes).flatMap(parseNode);

        switch (el.tagName.toLowerCase()) {
            case 'h2':
                if (/^\d+\./.test(el.innerText)) return [];
                return [
                    new Paragraph({
                        heading: HeadingLevel.HEADING_2,
                        children,
                        spacing: { before: 260, after: 160 },
                    }),
                ];
            case 'h3':
                return [
                    new Paragraph({
                        heading: HeadingLevel.HEADING_3,
                        children,
                        spacing: { before: 200, after: 140 },
                    }),
                ];
            case 'h4':
                return [
                    new Paragraph({
                        heading: HeadingLevel.HEADING_4,
                        children,
                        spacing: { before: 160, after: 120 },
                    }),
                ];
            case 'p':
                return [
                    new Paragraph({
                        children,
                        spacing: { after: 160 },
                    }),
                ];
            case 'li':
                return [
                    new Paragraph({
                        children,
                        bullet: { level: 0 },
                        spacing: { after: 80 },
                    }),
                ];
            default:
                return children;
        }
    };

    const today = dayjs().format('DD/MM/YYYY');
    const titlePage = [
        new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 360 },
        }),
        new Paragraph({
            text: 'Relat\u00f3rio de An\u00e1lise Fiscal',
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
        }),
        new Paragraph({
            text: `Gerado em: ${today}`,
            alignment: AlignmentType.CENTER,
        }),
        new Paragraph({ children: [new PageBreak()] }),
    ];

    const children = Array.from(element.childNodes).flatMap(parseNode);
    const doc = new Document({
        sections: [{ properties: {}, children: [...titlePage, ...children] }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
};
