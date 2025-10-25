# Frontend Contract Snapshot (2025-10-24)

Frozen description of the approved UI so backend refactors can preserve behaviour, navigation, and payload contracts.

## Route Topology
- `/` – single-page workspace rendered by `App.tsx`. No nested client routes; all views are conditional inside the root component.

## Global UI States & Flows
- **Pipeline lifecycle** – `pipelineStep` switches between `UPLOAD`, `PROCESSING`, `COMPLETE`, `ERROR`.
  - `UPLOAD`: shows `FileUpload`.
  - `PROCESSING`: shows `ProgressTracker` with live agent states from `useAgentOrchestrator`.
  - `COMPLETE`: renders report/dashboard/comparative views plus `ChatPanel`.
  - `ERROR`: renders `PipelineErrorDisplay` with the last error.
- **View selector** inside COMPLETE state – toggles `activeView` between `report`, `dashboard`, `comparative`.
- **Logs drawer** – `showLogs` toggles `LogsPanel`. Must remain off by default.
- **Notification toast** – `Toast` appears when `error` truthy while pipeline step is not ERROR.
- **Panel collapse** – `isPanelCollapsed` hides the left column; toggled from header button.
- **Chat streaming** – `isStreaming` drives send button state and stop control inside `ChatPanel`.
- **History** – `analysisHistory` accumulates every finished `auditReport` for comparative view.

## Data Contracts & Shared Types
- `AuditReport` (from `types.ts`) contains `summary`, `documents[]`, `aggregatedMetrics`, optional `accountingEntries`, `spedFile`, AI insights, cross validation results.
- `AgentStates` is a record of agent names (`ocr`, `auditor`, `classifier`, `crossValidator`, `intelligence`, `accountant`) to `{ status, progress }`.
- `ChatMessage` requires `{ id, sender ('user'|'ai'), text, optional chartData }`.
- Classification corrections persist in `localStorage` under `nexus-classification-corrections`.
- Environment variable `API_KEY` must be available on the web side for Google Gemini SDK.

## Component Contracts

### `Header` (`components/Header.tsx`)
- Props: `onReset()`, `showExports`, `showSpedExport`, `isExporting` (`ExportType | null`), `onExport(type)`, `onToggleLogs()`, `isPanelCollapsed?`, `onTogglePanel?()`.
- Behaviour: reset click restarts entire flow; export buttons disabled when exporting; SPED button only visible if `showSpedExport`.

### `FileUpload` (`components/FileUpload.tsx`)
- Props: `onStartAnalysis(files: File[])`, `disabled`.
- Behaviour: drag-and-drop plus file input; rejects files > 200 MB, duplicates; calls `onStartAnalysis` with accumulated files; displays local error text.

### `ProgressTracker` (`components/ProgressTracker.tsx`)
- Props: `agentStates: AgentStates`.
- Behaviour: renders per-agent status chip and textual progress. Expects stable agent keys listed above.

### `ReportViewer` (`components/ReportViewer.tsx`)
- Props: `report: AuditReport`, `onClassificationChange(docName, newClassification)`.
- Behaviour: renders summary metrics, per-document status, editable classification select, accounting entries, AI insights. Depends on `AuditReport.documents[].classification`, `.inconsistencies`, `.status`, `.score`.

### `Dashboard` (`components/Dashboard.tsx`)
- Props: `report: AuditReport`.
- Behaviour: renders aggregated metrics, charts (requires `report.aggregatedMetrics`, `documents`, `aiDrivenInsights`, `deterministicCrossValidation`).

### `IncrementalInsights` (`components/IncrementalInsights.tsx`)
- Props: `history: AuditReport[]`.
- Behaviour: comparative timeline, expects at least two reports to show differential insights.

### `ChatPanel` (`components/ChatPanel.tsx`)
- Props: `messages: ChatMessage[]`, `onSendMessage(message)`, `isStreaming`, `onStopStreaming()`, `reportTitle`, `setError(message|null)`, `onAddFiles(files)`.
- Behaviour: maintains text input, optional export-to-Markdown/PDF/HTML/JSON of chat via `exportConversationUtils`, handles incremental file upload via hidden input calling `onAddFiles`.

### `LogsPanel` (`components/LogsPanel.tsx`)
- Props: `onClose()`.
- Behaviour: reads logs from `services/logger` buffer. Displays list grouped by level.

### `PipelineErrorDisplay` (`components/PipelineErrorDisplay.tsx`)
- Props: `errorMessage: string | null`, `onReset()`.
- Behaviour: shows fatal error, offers retry via `onReset`.

### `Toast` (`components/Toast.tsx`)
- Props: `message: string`, `onClose()`.
- Behaviour: auto-dismiss button; overlay anchored bottom-right.

### Ancillary Components
- `AnalysisDisplay` expects `analysis: AnalysisResult`.
- `CrossValidationPanel` expects `results: CrossValidationResult[]`.
- `SmartSearch` expects `documents: AuditReport['documents']`, `onSearch(query) => Promise<SmartSearchResult>`, `isSearching`.
- `Chart` renders chart visualisations using `ChartData`.
- Icons (`components/icons.tsx`, `LogoIcon.tsx`) expose `className` prop.
- Maintain these props for adapter compatibility even if not currently composed in `App`.

## Hook Contract – `useAgentOrchestrator`
- Exposes:
  - `agentStates`
  - `auditReport` plus setter
  - `messages`
  - `isStreaming`
  - `error`
  - `isPipelineRunning` (derived)
  - `isPipelineComplete`
  - `pipelineError`
  - `runPipeline(files: File[])`
  - `handleSendMessage(message)`
  - `handleStopStreaming()`
  - `setError(message|null)`
  - `handleClassificationChange(docName, newType)`
  - `reset()`
- Internals:
  - Calls `importFiles` (from `utils/importPipeline`) -> returns `ImportedDoc[]`.
  - Invokes `runAudit`, `runClassification`, `runIntelligenceAnalysis`, `runAccountingAnalysis` sequentially.
  - Uses `startChat`/`sendMessageStream` (Gemini) after audit success.
  - Saves classification corrections to `localStorage`.
  - Uses `logger` service for structured logs.
- Any backend refactor must provide adapters so these functions resolve via network while preserving the same signatures and promise semantics (resolve to identical shapes, throw with compatible error messages).

## Service & Utility Touchpoints
- `services/chatService.ts` -> wraps Google Gemini chat (`@google/genai`).
- `services/geminiService.ts` -> requires `process.env.API_KEY`; handles JSON schema enforcement. Errors bubbled as `Error` with Portuguese messages.
- `services/logger.ts` -> in-memory circular buffer of `{ component, level, message, timestamp, context }`; exported `subscribe` observers.
- `utils/importPipeline.ts` -> handles client-side parsing (XML, CSV, XLSX, PDF via `pdfjs`, `tesseract`). Emits `ImportedDoc[]` with status flags.
- `utils/exportUtils.ts` / `exportConversationUtils.ts` -> convert DOM to PDF/DOCX/HTML etc; rely on `window`, `document`.
- `utils/fiscalCompare.ts` -> deterministic cross-validation producing `DeterministicCrossValidationResult[]`.
- `utils/rulesEngine.ts`, `rulesDictionary.ts` -> run declarative checks.

## External Dependencies & Config
- Uses Vite + React 19, Tailwind classes inline, no CSS modules.
- Relies on `pdfjs-dist`, `tesseract.js`, `xlsx`, `papaparse`, `docx`, `pdfmake`, `dayjs`, `jszip`, `html2canvas`.
- All data currently processed in-browser; large files can spike memory/CPU.
- No existing REST calls; all orchestration synchronous in hook. Backend integration must either:
  1. Provide API endpoints invoked by new adapters that plug into the existing hook functions, or
  2. Replace hook implementation while preserving exported API.

## Screen States (Loading/Empty/Error)
- `FileUpload` inline errors shown in component when invalid files.
- `ProgressTracker` displays each agent status with fallback text if `progress.step` empty.
- `ReportViewer` handles empty `accountingEntries` (renders "Nenhum lancamento gerado").
- `Dashboard` expects to handle absence of `aggregatedMetrics` and `aiDrivenInsights` (renders cards with placeholder copy).
- `IncrementalInsights` shows helper text when history length < 2.
- `ChatPanel` disables send button during streaming; displays placeholder "..." message until stream completes.
- `Toast` used for ephemeral non-blocking alerts; `PipelineErrorDisplay` for fatal ones.

## Fragile Integration Points
- Browser-only SDKs (pdfjs/tesseract) currently run on main thread; migrating to backend requires replacing with remote endpoints while keeping timing and message strings consistent.
- `localStorage` corrections must remain available; backend should return merged corrections so UI behaviour unchanged.
- Exports rely on DOM nodes; ensure report markup IDs/classes remain unchanged (`ReportViewer` renders inside `exportableContentRef`).
- Any backend service must keep event names, document classifications, and aggregated metrics keys stable so dashboards and insights map correctly.
- Gemini chat assumes CSV sample string and aggregated metrics; backend must still provide those to `startChat`.

## Existing Endpoints Consumed
- None. The UI imports local modules rather than calling HTTP endpoints. Adapters must emulate:
  - `importFiles(files) -> Promise<ImportedDoc[]>`
  - `runAudit(docs, corrections) -> Promise<AuditReport>`
  - `runClassification(report, corrections) -> Promise<AuditReport>` (mutates sections)
  - `runIntelligenceAnalysis(report) -> Promise<AuditReport>`
  - `runAccountingAnalysis(report) -> Promise<AuditReport>`
  - `runDeterministicCrossValidation(report) -> Promise<DeterministicCrossValidationResult[]>`
  - `startChat(dataSample, aggregatedMetrics) -> Chat`
  - `sendMessageStream(chat, message) -> AsyncGenerator<string>`
- When backed by Workers/Queues, expose HTTP APIs that return these structures and retain naming.

## Next Steps for Backend Refactor
- Create adapters inside `apps/web` that call the new Worker endpoints while preserving the existing function signatures.
- Ensure route `/api/ingest`, `/api/reports/:docId`, `/api/assistant` match structures expected by the UI or provide translation layers without changing component props.

