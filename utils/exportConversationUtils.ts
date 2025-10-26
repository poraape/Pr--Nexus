import dayjs from 'dayjs';
import type { ChatMessage } from '../types';

/**
 * Utility helpers shared across conversation export flavours.
 */

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

const markdownToPlainText = (markdown: string): string =>
    markdown
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`{3}([\s\S]*?)`{3}/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\* (.*?)(?=\n|$)/g, '\u2022 $1')
        .replace(/<br\s*\/?>/g, '')
        .replace(/\r\n|\r/g, '\n');

const escapeHtml = (value: string): string =>
    value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const conversationRows = (messages: ChatMessage[]) =>
    messages.filter(message => message.id !== 'initial-ai-message');

export const exportConversationToHtml = async (
    messages: ChatMessage[],
    title: string,
    filename: string,
) => {
    const exportedAt = dayjs().format('DD/MM/YYYY HH:mm');
    const messageHtml = conversationRows(messages)
        .map(message => {
            const author = message.sender === 'user' ? 'Usu\u00e1rio' : 'Assistente';
            const content = escapeHtml(message.text).replace(/\n/g, '<br>');
            return `
            <div class="message ${message.sender}-message">
                <div class="author">${author}</div>
                <div class="content">${content}</div>
            </div>`;
        })
        .join('\n');

    const htmlContent = `<!DOCTYPE html>
<html lang="pt-BR">
    <head>
        <meta charset="UTF-8">
        <title>${escapeHtml(title)}</title>
        <style>
            :root { color-scheme: dark; }
            body { font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #e5e7eb; background-color: #111827; max-width: 800px; margin: 20px auto; padding: 24px; border: 1px solid #374151; border-radius: 12px; }
            h1 { font-size: 1.8em; color: #f9fafb; border-bottom: 1px solid #4b5563; padding-bottom: 12px; margin-bottom: 24px; }
            .meta { font-size: 0.9em; color: #9ca3af; margin-bottom: 24px; }
            .message { border: 1px solid; border-radius: 10px; margin-bottom: 18px; overflow: hidden; }
            .author { font-weight: 600; padding: 10px 16px; border-bottom: 1px solid; letter-spacing: 0.01em; }
            .content { padding: 16px; white-space: pre-wrap; word-break: break-word; }
            .user-message { border-color: #2563eb; }
            .user-message .author { background-color: #2563eb; color: #fff; border-bottom-color: #1d4ed8; }
            .ai-message { border-color: #4b5563; }
            .ai-message .author { background-color: #374151; color: #d1d5db; border-bottom-color: #1f2937; }
            strong { color: #60a5fa; }
        </style>
    </head>
    <body>
        <h1>${escapeHtml(title)}</h1>
        <p class="meta">Exportado em ${exportedAt} pela Nexus QuantumI2A2</p>
        ${messageHtml}
    </body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    saveAs(blob, `${filename}.html`);
};

export const exportConversationToPdf = async (
    messages: ChatMessage[],
    title: string,
    filename: string,
) => {
    const pdfMakeModule = await import('pdfmake/build/pdfmake');
    const pdfMake: any = pdfMakeModule.default || pdfMakeModule;
    const pdfFontsModule = await import('pdfmake/build/vfs_fonts');
    const fonts: any = pdfFontsModule.default || pdfFontsModule;

    if (fonts.pdfMake?.vfs) {
        pdfMake.vfs = fonts.pdfMake.vfs;
    } else if (fonts.vfs) {
        pdfMake.vfs = fonts.vfs;
    } else {
        console.error('pdfmake fonts module did not expose a vfs object:', fonts);
        throw new Error('Falha ao carregar as fontes para a gera\u00e7\u00e3o do PDF.');
    }

    const today = dayjs().format('DD/MM/YYYY');

    const content: any[] = [
        { text: 'Nexus QuantumI2A2', style: 'mainTitle', alignment: 'center' },
        { text: title, style: 'subtitle', alignment: 'center' },
        { text: `Gerado em: ${today}`, style: 'meta', alignment: 'center', margin: [0, 4, 0, 40] },
    ];

    conversationRows(messages).forEach(message => {
        content.push({
            text: message.sender === 'user' ? 'Usu\u00e1rio' : 'Assistente',
            style: 'author',
        });
        content.push({
            text: markdownToPlainText(message.text),
            style: 'paragraph',
        });
    });

    const definition = {
        content,
        styles: {
            mainTitle: { fontSize: 22, bold: true, margin: [0, 0, 0, 8], color: '#0ea5e9' },
            subtitle: { fontSize: 16, italics: true, margin: [0, 0, 0, 16] },
            meta: { fontSize: 9, color: '#9ca3af' },
            author: { fontSize: 11, bold: true, margin: [0, 12, 0, 4], color: '#3b82f6' },
            paragraph: { fontSize: 10, margin: [0, 0, 0, 10] },
        },
        defaultStyle: { fontSize: 10 },
        footer: (currentPage: number, pageCount: number) => ({
            text: `${currentPage} de ${pageCount}`,
            alignment: 'right',
            margin: [0, 0, 40, 16],
            style: 'meta',
        }),
    };

    pdfMake.createPdf(definition).download(`${filename}.pdf`);
};

export const exportConversationToDocx = async (
    messages: ChatMessage[],
    title: string,
    filename: string,
) => {
    const docx = await import('docx');
    const { AlignmentType, Document, HeadingLevel, Paragraph, Packer, ShadingType, TextRun, PageBreak } = docx;

    const today = dayjs().format('DD/MM/YYYY');

    const titleSection = [
        new Paragraph({
            text: 'Nexus QuantumI2A2',
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
        }),
        new Paragraph({
            text: title,
            heading: HeadingLevel.HEADING_2,
            alignment: AlignmentType.CENTER,
            spacing: { after: 320 },
        }),
        new Paragraph({
            text: `Gerado em: ${today}`,
            alignment: AlignmentType.CENTER,
        }),
        new Paragraph({ children: [new PageBreak()] }),
    ];

    const body = conversationRows(messages).flatMap(message => {
        const isUser = message.sender === 'user';
        const author = isUser ? 'Usu\u00e1rio' : 'Assistente';

        const textRuns = markdownToPlainText(message.text)
            .split(/\n{2,}/)
            .map(line => new Paragraph({ text: line, spacing: { after: 120 } }));

        return [
            new Paragraph({
                children: [new TextRun({ text: author, bold: true })],
                shading: {
                    type: ShadingType.CLEAR,
                    color: 'auto',
                },
                spacing: { after: 80 },
                style: isUser ? 'UserAuthor' : 'AssistantAuthor',
            }),
            ...textRuns,
        ];
    });

    const doc = new Document({
        styles: {
            paragraphStyles: [
                {
                    id: 'UserAuthor',
                    name: 'User Author',
                    basedOn: 'Normal',
                    next: 'Normal',
                    run: { color: 'FFFFFF' },
                    paragraph: { shading: { color: '2563EB', fill: '2563EB', type: 'CLEAR' } },
                },
                {
                    id: 'AssistantAuthor',
                    name: 'Assistant Author',
                    basedOn: 'Normal',
                    next: 'Normal',
                    run: { color: 'E5E7EB' },
                    paragraph: { shading: { color: '374151', fill: '374151', type: 'CLEAR' } },
                },
            ],
        },
        sections: [
            {
                properties: {},
                children: [...titleSection, ...body],
            },
        ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
};
