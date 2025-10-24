import dayjs from 'dayjs';
import type { ChatMessage } from '../types';

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

const markdownToSimpleText = (md: string): string => {
    return md
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\* (.*?)(?=\n|$)/g, '• $1')
      .replace(/<br\s*\/?>/g, '');
};

// --- Export Functions ---

export const exportConversationToHtml = async (messages: ChatMessage[], title: string, filename: string) => {
    const today = dayjs().format('DD/MM/YYYY HH:mm');
    const messageHtml = messages
        .filter(m => m.id !== 'initial-ai-message') // Don't export initial prompt
        .map(message => `
        <div class="message ${message.sender}-message">
            <div class="author">${message.sender === 'user' ? 'Usuário' : 'Sistema'}</div>
            <div class="content">${message.text.replace(/\n/g, '<br>')}</div>
        </div>
    `).join('');

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
            <meta charset="UTF-8">
            <title>${title}</title>
            <style>
                body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #e5e7eb; background-color: #111827; max-width: 800px; margin: 20px auto; padding: 20px; border: 1px solid #374151; border-radius: 8px; }
                h1 { font-size: 1.8em; color: #ffffff; border-bottom: 1px solid #4b5563; padding-bottom: 10px; margin-bottom: 20px; }
                .meta { font-size: 0.9em; color: #9ca3af; margin-bottom: 20px; }
                .message { border: 1px solid; border-radius: 8px; margin-bottom: 1.5rem; }
                .author { font-weight: bold; padding: 8px 12px; border-bottom: 1px solid; }
                .content { padding: 12px; white-space: pre-wrap; word-wrap: break-word; }
                .user-message { border-color: #2563eb; }
                .user-message .author { background-color: #2563eb; color: white; border-bottom-color: #1d4ed8; border-top-left-radius: 7px; border-top-right-radius: 7px; }
                .ai-message { border-color: #4b5563; }
                .ai-message .author { background-color: #374151; color: #d1d5db; border-bottom-color: #1f2937; border-top-left-radius: 7px; border-top-right-radius: 7px; }
                strong { color: #60a5fa; }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            <p class="meta">Exportado em: ${today} por Nexus QuantumI2A2</p>
            ${messageHtml}
        </body>
        </html>
    `;
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    saveAs(blob, `${filename}.html`);
};

export const exportConversationToPdf = async (messages: ChatMessage[], title: string, filename: string) => {
    const pdfMake = await import('pdfmake/build/pdfmake');
    const pdfFonts = await import('pdfmake/build/vfs_fonts');
    
    // Handle CJS/ESM module interop for vfs_fonts. The dynamically imported
    // module often nests the actual content under a `default` property.
    const fonts = pdfFonts.default || pdfFonts;
    if (fonts.pdfMake && fonts.pdfMake.vfs) {
        pdfMake.vfs = fonts.pdfMake.vfs;
    } else {
        console.error("Failed to load pdfmake vfs fonts", fonts);
        throw new Error("Falha ao carregar as fontes para a geração do PDF.");
    }

    const today = dayjs().format('DD/MM/YYYY');

    const content: any[] = [
        { text: 'Nexus QuantumI2A2', style: 'mainTitle', alignment: 'center' },
        { text: title, style: 'subtitle', alignment: 'center' },
        { text: `\n\nGerado em: ${today}`, style: 'meta', alignment: 'center' },
        { text: '', pageBreak: 'after' }
    ];

    messages
        .filter(m => m.id !== 'initial-ai-message')
        .forEach(message => {
            content.push({
                text: message.sender === 'user' ? 'Usuário' : 'Sistema',
                style: 'author',
                bold: true
            });
            content.push({
                text: markdownToSimpleText(message.text),
                style: 'paragraph'
            });
    });

    const docDefinition = {
        content,
        styles: {
            mainTitle: { fontSize: 24, bold: true, margin: [0, 200, 0, 10] },
            subtitle: { fontSize: 16, italics: true, margin: [0, 0, 0, 20] },
            meta: { fontSize: 10, color: '#888888' },
            author: { fontSize: 12, bold: true, margin: [0, 10, 0, 2], color: '#3b82f6' },
            paragraph: { fontSize: 10, margin: [0, 0, 0, 10], },
        },
        defaultStyle: { fontSize: 10 },
        footer: function(currentPage: number, pageCount: number) {
            return { text: `${currentPage.toString()} de ${pageCount}`, alignment: 'right', style: 'meta', margin: [0, 0, 40, 0] };
        }
    };

    pdfMake.createPdf(docDefinition).download(`${filename}.pdf`);
};


export const exportConversationToDocx = async (messages: ChatMessage[], title: string, filename: string) => {
    const docx = await import('docx');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak, ShadingType } = docx;

    const today = dayjs().format('DD/MM/YYYY');
    
    const titlePage = [
        new Paragraph({ text: 'Nexus QuantumI2A2', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
        new Paragraph({ text: title, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.CENTER, spacing: { after: 400 } }),
        new Paragraph({ text: `Gerado em: ${today}`, alignment: AlignmentType.CENTER }),
        new Paragraph({ children: [new PageBreak()] }),
    ];
    
    const conversationBody = messages
        .filter(m => m.id !== 'initial-ai-message')
        .flatMap(message => {
            const isUser = message.sender === 'user';
            const authorText = isUser ? 'Usuário' : 'Sistema';
            
            // Simple markdown parsing
            const textRuns = message.text.split(/(\*\*.*?\*\*)/g).map(part => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return new TextRun({ text: part.slice(2, -2), bold: true });
                }
                return new TextRun(part);
            });
            
            return [
                new Paragraph({
                    children: [new TextRun({ text: authorText, bold: true })],
                    shading: {
                        type: ShadingType.CLEAR,
                        color: "auto",
                        fill: isUser ? "2563eb" : "374151",
                    },
                    style: "user-message",
                }),
                new Paragraph({
                    children: textRuns,
                    spacing: { after: 200 }
                })
            ];
        });

    const doc = new Document({
        styles: {
            paragraphStyles: [{
                id: "user-message",
                name: "User Message",
                basedOn: "Normal",
                next: "Normal",
                run: {
                    color: "FFFFFF",
                },
            }]
        },
        sections: [{
            properties: {},
            children: [...titlePage, ...conversationBody],
        }],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${filename}.docx`);
};