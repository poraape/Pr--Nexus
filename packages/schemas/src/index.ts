import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const numericString = z.union([
  z.string(),
  z.number()
]);

const nonEmptyString = z.string().min(1);
const isoDateTime = z.string().datetime({ offset: true });

const RecordDataValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.any()),
  z.record(z.any())
]);

export const DocumentSchema = z.object({
  docId: nonEmptyString,
  tenantId: nonEmptyString.describe('Tenant identifier that owns the document.'),
  source: z.enum(['upload', 'api', 'backfill', 'sync']).default('upload'),
  kind: z.enum(['NFE_XML', 'CSV', 'XLSX', 'PDF', 'IMAGE', 'UNSUPPORTED']),
  name: nonEmptyString,
  sizeBytes: z.number().int().nonnegative(),
  checksum: nonEmptyString.optional(),
  uploadedAt: isoDateTime,
  status: z.enum(['parsed', 'ocr_needed', 'unsupported', 'error']),
  storageUrl: z.string().url().optional(),
  encoding: z.string().optional(),
  meta: z.object({
    sourceZip: z.string().optional(),
    internalPath: z.string().optional(),
    tags: z.array(z.string()).optional()
  }).optional(),
  data: z.array(z.record(nonEmptyString, RecordDataValue)).optional(),
  text: z.string().optional(),
  error: z.string().optional()
});

export type Document = z.infer<typeof DocumentSchema>;
export const DocumentJsonSchema = zodToJsonSchema(DocumentSchema, 'Document');

export const ParsedDocumentSchema = z.object({
  doc: DocumentSchema,
  parsedAt: isoDateTime,
  parserVersion: nonEmptyString,
  ocrApplied: z.boolean().default(false),
  normalizedText: z.string().optional(),
  structuredData: z
    .array(
      z.object({
        lineId: nonEmptyString,
        values: z.record(nonEmptyString, RecordDataValue),
        warnings: z.array(z.string()).optional()
      })
    )
    .optional(),
  attachments: z
    .array(
      z.object({
        filename: nonEmptyString,
        mimeType: nonEmptyString,
        sizeBytes: z.number().int().nonnegative()
      })
    )
    .optional()
});

export type ParsedDocument = z.infer<typeof ParsedDocumentSchema>;
export const ParsedDocumentJsonSchema = zodToJsonSchema(ParsedDocumentSchema, 'ParsedDocument');

export const NormalizedLineSchema = z.object({
  lineId: nonEmptyString,
  docId: nonEmptyString,
  sequence: z.number().int().nonnegative(),
  values: z.record(nonEmptyString, RecordDataValue),
  normalizedAt: isoDateTime,
  issues: z.array(z.string()).default([])
});

export const NormalizedDocumentSchema = z.object({
  doc: DocumentSchema,
  lines: z.array(NormalizedLineSchema),
  normalizationVersion: nonEmptyString,
  normalizedAt: isoDateTime,
  unitSystem: z.enum(['metric', 'imperial']).default('metric'),
  currency: z.string().default('BRL')
});

export type NormalizedDocument = z.infer<typeof NormalizedDocumentSchema>;
export const NormalizedDocumentJsonSchema = zodToJsonSchema(NormalizedDocumentSchema, 'NormalizedDocument');

export const InconsistencySchema = z.object({
  code: nonEmptyString,
  message: nonEmptyString,
  explanation: nonEmptyString,
  normativeBase: z.string().optional(),
  severity: z.enum(['ERRO', 'ALERTA', 'INFO'])
});

export const ClassificationSchema = z.object({
  operationType: z.enum(['Compra', 'Venda', 'Devolução', 'Serviço', 'Transferência', 'Outros']),
  businessSector: nonEmptyString,
  confidence: z.number().min(0).max(1)
});

export type Classification = z.infer<typeof ClassificationSchema>;
export const ClassificationJsonSchema = zodToJsonSchema(ClassificationSchema, 'Classification');

export const AuditedDocumentSchema = z.object({
  doc: DocumentSchema,
  status: z.enum(['OK', 'ALERTA', 'ERRO']),
  score: z.number().min(0).max(1).optional(),
  inconsistencies: z.array(InconsistencySchema),
  classification: ClassificationSchema.optional()
});

export const AccountingEntrySchema = z.object({
  docId: nonEmptyString,
  docName: nonEmptyString,
  account: nonEmptyString,
  type: z.enum(['D', 'C']),
  value: z.number()
});

export const TaxApportionSchema = z.object({
  docId: nonEmptyString,
  taxType: z.enum(['ICMS', 'PIS', 'COFINS', 'ISS', 'IPI', 'OTHER']),
  jurisdiction: nonEmptyString,
  basisAmount: z.number(),
  taxAmount: z.number(),
  confidence: z.number().min(0).max(1),
  methodology: nonEmptyString
});

export type TaxApportion = z.infer<typeof TaxApportionSchema>;
export const TaxApportionJsonSchema = zodToJsonSchema(TaxApportionSchema, 'TaxApportion');

export const ReconIssueSchema = z.object({
  code: nonEmptyString,
  description: nonEmptyString,
  severity: z.enum(['INFO', 'ALERTA', 'CRITICO']),
  references: z.array(nonEmptyString).optional()
});

export const ReconReportSchema = z.object({
  docId: nonEmptyString,
  status: z.enum(['OK', 'ALERTA', 'ERRO']),
  reconciledAt: isoDateTime,
  issues: z.array(ReconIssueSchema),
  summary: z.string()
});

export type ReconReport = z.infer<typeof ReconReportSchema>;
export const ReconReportJsonSchema = zodToJsonSchema(ReconReportSchema, 'ReconReport');

export const LedgerEntrySchema = z.object({
  docId: nonEmptyString,
  entryId: nonEmptyString,
  account: nonEmptyString,
  type: z.enum(['D', 'C']),
  amount: z.number(),
  currency: z.string().default('BRL'),
  memo: z.string().optional()
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;
export const LedgerEntryJsonSchema = zodToJsonSchema(LedgerEntrySchema, 'LedgerEntry');

export const AuditSummarySchema = z.object({
  title: nonEmptyString,
  summary: nonEmptyString,
  keyMetrics: z.array(
    z.object({
      metric: nonEmptyString,
      value: z.union([nonEmptyString, z.number()]),
      insight: nonEmptyString
    })
  ),
  actionableInsights: z.array(nonEmptyString),
  strategicRecommendations: z.array(nonEmptyString).optional()
});

export const AIFindingSchema = z.object({
  category: z.enum(['Eficiência Operacional', 'Risco Fiscal', 'Oportunidade de Otimização', 'Anomalia de Dados']),
  description: nonEmptyString,
  severity: z.enum(['INFO', 'BAIXA', 'MÉDIA', 'ALTA']),
  evidence: z.array(nonEmptyString)
});

export const CrossValidationResultSchema = z.object({
  attribute: nonEmptyString,
  observation: nonEmptyString,
  documents: z.array(
    z.object({
      name: nonEmptyString,
      value: z.union([nonEmptyString, z.number()])
    })
  )
});

export const DeterministicDiscrepancySchema = z.object({
  valueA: z.union([nonEmptyString, z.number()]),
  docA: z.object({
    name: nonEmptyString,
    internalPath: z.string().optional()
  }),
  valueB: z.union([nonEmptyString, z.number()]),
  docB: z.object({
    name: nonEmptyString,
    internalPath: z.string().optional()
  })
});

export const DeterministicCrossValidationSchema = z.object({
  comparisonKey: nonEmptyString,
  attribute: nonEmptyString,
  description: nonEmptyString,
  discrepancies: z.array(DeterministicDiscrepancySchema),
  severity: z.enum(['ALERTA', 'INFO'])
});

export const AuditReportSchema = z.object({
  traceId: nonEmptyString,
  docId: nonEmptyString,
  summary: AuditSummarySchema,
  documents: z.array(AuditedDocumentSchema),
  aggregatedMetrics: z.record(nonEmptyString, z.union([nonEmptyString, z.number()])).optional(),
  accountingEntries: z.array(AccountingEntrySchema).optional(),
  ledgerEntries: z.array(LedgerEntrySchema).optional(),
  taxApportion: z.array(TaxApportionSchema).optional(),
  reconReport: ReconReportSchema.optional(),
  aiDrivenInsights: z.array(AIFindingSchema).optional(),
  crossValidationResults: z.array(CrossValidationResultSchema).optional(),
  deterministicCrossValidation: z.array(DeterministicCrossValidationSchema).optional(),
  generatedAt: isoDateTime
});

export type AuditReport = z.infer<typeof AuditReportSchema>;
export const AuditReportJsonSchema = zodToJsonSchema(AuditReportSchema, 'AuditReport');

export const ClassificationCorrectionSchema = z.object({
  docName: nonEmptyString,
  operationType: ClassificationSchema.shape.operationType
});

export const SchemaRegistry = {
  DocumentSchema,
  ParsedDocumentSchema,
  NormalizedDocumentSchema,
  AuditReportSchema,
  ClassificationSchema,
  LedgerEntrySchema,
  TaxApportionSchema,
  ReconReportSchema
};

export const JsonSchemaRegistry = {
  Document: DocumentJsonSchema,
  ParsedDocument: ParsedDocumentJsonSchema,
  NormalizedDocument: NormalizedDocumentJsonSchema,
  AuditReport: AuditReportJsonSchema,
  Classification: ClassificationJsonSchema,
  LedgerEntry: LedgerEntryJsonSchema,
  TaxApportion: TaxApportionJsonSchema,
  ReconReport: ReconReportJsonSchema
};

export type SchemaRegistryKey = keyof typeof SchemaRegistry;
