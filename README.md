# Nexus QuantumI2A2: Análise Fiscal com IA

Nexus QuantumI2A2 é uma plataforma de auditoria fiscal que combina uma SPA React leve com um backend FastAPI orientado a agentes. O processamento de arquivos, regras fiscais, chamadas de IA e geração de relatórios é realizado exclusivamente no servidor, garantindo conformidade com o blueprint MAS distribuído.

---

## Funcionalidades Principais

- **Pipeline Multiagente no Backend:** Extração, validação, classificação, cross-validation, inteligência e contabilidade residem em módulos Python (`backend/agents/*`) orquestrados por `backend/graph.py`.
- **API Gateway FastAPI:** Endpoints `/api/v1/upload`, `/status/{task_id}`, `/report/{task_id}`, `/chat`, `/llm/generate-json` centralizam autenticação, filas e entrega de resultados (`backend/api/endpoints.py`).
- **Assíncrono e Extensível:** Tarefas publicadas em RabbitMQ (modo produção) ou executadas inline via thread pool (modo desenvolvimento). O worker dedicado é inicializado por `python -m backend.worker_main`.
- **Persistência Completa:** PostgreSQL armazena tasks, status e relatórios (`backend/database/models.py`); ChromaDB mantém embeddings para RAG (`backend/agents/consultant_agent.py`).
- **Frontend Thin Client:** O React apenas sobe arquivos suportados (XML, CSV, JSON, PDF, OCR e ZIP) e acompanha o progresso via polling/SSE (`hooks/useAgentOrchestrator.ts`, `components/FileUpload.tsx`).
- **Chat Consultivo com RAG:** Consultor fiscal responde perguntas com contexto indexado no backend.

---

## Arquitetura Atual (MAS Server-Side)

```text
Frontend (React) ──► API Gateway (FastAPI) ──► RabbitMQ ──► Worker (AgentGraph) ──► PostgreSQL / ChromaDB
                                              │
                                              └── Storage de Arquivos
```

- **Frontend (React/Vite)**  
  - Upload restrito a arquivos compreendidos pelo backend (`components/FileUpload.tsx`).  
  - Polling de status (`/api/v1/status/{task_id}`) e busca de relatório final (`/api/v1/report/{task_id}`).  
  - Chat via SSE (`/api/v1/chat`) sem expor chaves de API.  

- **FastAPI Gateway (`backend/main.py`, `backend/api/endpoints.py`)**  
  - Persiste metadados de tarefas no PostgreSQL.  
  - Publica mensagens em RabbitMQ via `RabbitMQPublisher` ou executa inline com `InlineTaskPublisher`.  
  - Posta atualizações em `SQLAlchemyStatusRepository` e salva relatórios em `SQLAlchemyReportRepository`.

- **Workers (`backend/worker.py`, `backend/worker_main.py`)**  
  - Consumidor RabbitMQ implementado em `RabbitMQConsumer` (`backend/services/task_queue.py`).  
  - `AuditWorker` injeta agentes via `AgentGraph`, atualizando status a cada fase (`backend/graph.py`).  
  - Persistência de arquivos pela `FileStorage` (`backend/services/storage.py`).  

- **Persistência e RAG**  
  - `backend/database/models.py`: modelos `Task` e `Report`.  
  - `backend/agents/consultant_agent.py`: indexação no ChromaDB e consultas com LLM server-side (Gemini/DeepSeek).  

---

## Execução Local

### 1. Backend

```bash
python -m venv .venv
source .venv/bin/activate           # PowerShell: .\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

Defina as variáveis de ambiente (arquivo `.env` na raiz ou export direto):

```env
POSTGRES_DSN=postgresql+psycopg://postgres:postgres@localhost:5432/nexus
STORAGE_PATH=backend/storage/uploads
CHROMA_PERSIST_DIRECTORY=backend/.chroma
TASK_DISPATCH_MODE=inline              # use "rabbitmq" para produção
RABBITMQ_URL=amqp://guest:guest@localhost:5672/
RABBITMQ_QUEUE=audit_tasks
GEMINI_API_KEY=***
FRONTEND_ORIGIN=http://localhost:5173
```

Inicie a API:

```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Worker de Processamento

- **Modo inline (padrão):** nenhuma ação extra necessária; as tarefas são executadas em threads dentro do processo FastAPI.
- **Modo RabbitMQ:** defina `TASK_DISPATCH_MODE=rabbitmq`, suba o broker e execute em outro terminal:

```bash
python -m backend.worker_main
```

### 3. Frontend

```bash
npm install
VITE_BACKEND_URL=http://localhost:8000 npm run dev -- --host 0.0.0.0 --port 5173
```

A aplicação estará em `http://localhost:5173`.

---

## Execução com Docker Compose

Um ambiente completo (PostgreSQL, RabbitMQ, FastAPI, Worker e Vite) está definido em `docker-compose.yml`.

```bash
# Exporte a chave do LLM antes de subir, se necessário
export GEMINI_API_KEY=***
docker compose up --build
```

Serviços expostos:

- FastAPI: `http://localhost:8000`
- Frontend: `http://localhost:5173`
- RabbitMQ Management: `http://localhost:15672` (guest/guest)
- PostgreSQL: `localhost:5432`

Volumes nomeados preservam uploads, embeddings e dados do banco (`backend_storage`, `backend_chroma`, `postgres_data`, `rabbitmq_data`).

---

## Estrutura de Pastas Relevante

```
backend/
  agents/                   # Agentes Python (Intelligence, Accountant, etc.)
  api/                      # Endpoints FastAPI
  core/config.py            # Configurações e carregamento de env
  database/                 # SQLAlchemy engine e modelos
  graph.py                  # Orquestração do pipeline multiagente
  worker.py                 # AuditWorker e interface MessageBroker
  worker_main.py            # Entry point para consumidor RabbitMQ
  services/
    task_queue.py           # Inline/RabbitMQ publishers + RabbitMQConsumer
    storage.py              # Persistência de arquivos
frontend (raiz do projeto)
  components/               # UI, upload, dashboards
  hooks/useAgentOrchestrator.ts
  services/                 # httpClient/chatService delegando ao backend
  types.ts                  # Tipos compartilhados com o backend
docker-compose.yml          # Orquestração local completa
backend/Dockerfile          # Imagem base para API e worker
```

Os antigos agentes TypeScript client-side foram removidos (agora toda a lógica está em Python).

---

## Variáveis de Ambiente Importantes

| Variável | Descrição |
| --- | --- |
| `POSTGRES_DSN` | DSN usado pelo SQLAlchemy para persistir tarefas e relatórios. |
| `TASK_DISPATCH_MODE` | `inline` (padrão) ou `rabbitmq`. Controla como as tasks são enfileiradas. |
| `RABBITMQ_URL` / `RABBITMQ_QUEUE` | Configuração do broker quando `TASK_DISPATCH_MODE=rabbitmq`. |
| `STORAGE_PATH` | Diretório para uploads persistidos antes do processamento. |
| `CHROMA_PERSIST_DIRECTORY` | Pasta usada pelo ChromaDB para embeddings. |
| `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` | Chaves dos provedores de LLM. Nunca expostas ao frontend. |
| `FRONTEND_ORIGIN` | Origin autorizado para CORS. |
| `VITE_BACKEND_URL` (frontend) | URL do gateway FastAPI consumida pelo SPA. |

---

## Testes

O backend possui testes PyTest para agentes e grafo (`backend/tests/*`). Execute:

```bash
pytest backend/tests
```

> Nota: os testes definem `DISABLE_CONSULTANT_AGENT=1` para evitar chamadas externas ao inicializar o consultor de IA.

---

## Observabilidade e disponibilidade

- **Endpoint de saúde:** `GET /health` responde `{ "status": "ok" }` a partir do `backend/main.py`, permitindo que load balancers e monitores verifiquem se a API está ativa.
- **Script keep-alive opcional:** para evitar que a Space hiberne, execute periodicamente o utilitário `scripts/keep_alive.py`, que realiza pings no endpoint de saúde.

```bash
python scripts/keep_alive.py --url https://<sua-space>.hf.space --interval 600
```

Variáveis de ambiente (`SPACE_URL`, `SPACE_HEALTH_ENDPOINT`, `SPACE_PING_INTERVAL`, `SPACE_PING_TIMEOUT`) também podem ser usadas para configurar o script em serviços externos de cron.

---

## CI/CD e deploy para Hugging Face Space

Um workflow GitHub Actions (`.github/workflows/deploy.yml`) automatiza testes, build e deploy:

1. **Lint opcional:** roda `ruff` e `mypy` (não bloqueia o pipeline, apenas antecipa falhas).
2. **Testes e build:** instala dependências Python, executa `pytest backend/tests`, instala dependências do frontend (`npm ci`) e roda `npm run build`.
3. **Deploy:** em pushes para `main`, usa a action `huggingface/space-pusher` para enviar o repositório para a Space configurada.

### Configuração necessária

Crie os seguintes segredos no repositório GitHub:

| Segredo | Descrição |
| --- | --- |
| `HF_TOKEN` | Token da conta no Hugging Face com permissão de escrita na Space. |
| `HF_SPACE_ID` | Identificador completo da Space (`usuario/nome-da-space`). |

### Fluxo de atualização

1. Faça commits das alterações.
2. Envie para o branch principal: `git push origin main`.
3. Aguarde o workflow concluir (`CI and Deploy to Space`). Ao final, a Space é atualizada automaticamente.

Para builds manuais (ex.: hotfix), abra a aba *Actions* no GitHub e dispare `CI and Deploy to Space` via `Run workflow`.

### Rollback

- Identifique o commit saudável (`git log`).
- Recrie o estado desejado (`git revert <sha>` ou `git checkout <sha> && git push origin HEAD:main`).
- O push aciona novamente o workflow, publicando a versão anterior na Space.

Se a Space precisar ser reimplantada sem alterações de código, execute o workflow manualmente ou utilize `huggingface-cli repo push` com o commit conhecido.

---

## Segurança

- Chaves de LLM são carregadas apenas no backend via variáveis de ambiente (`backend/core/config.py`).
- Frontend não contém segredos; interage exclusivamente com a API.
- Upload de arquivos agora é validado no cliente para aceitar somente formatos processados pelo backend (`components/FileUpload.tsx`).  
- Recomenda-se habilitar HTTPS, secret management e autenticação no deployment final.
