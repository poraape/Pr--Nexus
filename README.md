# Nexus QuantumI2A2: Análise Fiscal com IA

**Nexus QuantumI2A2** é uma Single Page Application (SPA) de análise fiscal interativa que processa dados de Notas Fiscais Eletrônicas (NFe) e gera insights acionáveis através de um sistema de IA que simula múltiplos agentes especializados.

Esta aplicação demonstra uma arquitetura frontend completa e robusta, onde todo o processamento, desde o parsing de arquivos até a análise por IA, ocorre diretamente no navegador do cliente, combinando análise determinística com o poder de modelos de linguagem generativa (LLMs) para fornecer uma análise fiscal completa e um assistente de chat inteligente.

---

## ✨ Funcionalidades Principais

*   **Pipeline Multiagente Client-Side:** Uma cadeia de agentes especializados (Importação/OCR, Auditor, Classificador, Agente de Inteligência, Contador) processa os arquivos em etapas diretamente no navegador.
*   **Upload Flexível de Arquivos:** Suporte para múltiplos formatos, incluindo `XML`, `CSV`, `XLSX`, `PDF`, imagens (`PNG`, `JPG`) e arquivos `.ZIP` contendo múltiplos documentos.
*   **Análise Fiscal Aprofundada por IA:** Geração de um relatório detalhado com:
    *   **Resumo Executivo e Recomendações Estratégicas** gerados por IA.
    *   **Detecção de Anomalias por IA** que vai além de regras fixas.
    *   **Validação Cruzada (Cross-Validation)** entre documentos para encontrar discrepâncias sutis.
*   **Busca Inteligente (Smart Search):** Interaja com seus dados através de perguntas em linguagem natural diretamente no dashboard.
*   **Chat Interativo com IA:** Um assistente de IA, contextualizado com os dados do relatório, permite explorar os resultados e gera visualizações de dados sob demanda.
*   **Dashboards Dinâmicos:** Painéis interativos com KPIs, gráficos e filtros para uma visão aprofundada dos dados fiscais.
*   **Apuração Contábil e Geração de SPED/EFD:** Geração automática de lançamentos contábeis e de um arquivo de texto no layout simplificado do SPED Fiscal.
*   **Exportação de Relatórios:** Exporte a análise completa ou as conversas do chat para formatos como `PDF`, `DOCX`, `HTML` e `Markdown`.

---

## 🏗️ Arquitetura Atual: Frontend-Only com IA no Navegador

A implementação atual é uma demonstração poderosa de uma arquitetura totalmente client-side, executada no navegador do usuário.

### Frontend (Esta Aplicação)

A aplicação é uma SPA desenvolvida com **React** e **TypeScript**, utilizando **TailwindCSS** para estilização. Ela é responsável por:
*   Fornecer uma interface de usuário rica e interativa.
*   Executar o pipeline de agentes simulado no lado do cliente (`useAgentOrchestrator`).
*   Enviar requisições para o backend para tarefas de IA (RAG, chat e análises avançadas), mantendo as chaves de API fora do navegador.
*   Utilizar bibliotecas como Tesseract.js e PDF.js (com Web Workers) para processamento pesado de arquivos em background sem travar a UI.
*   Renderizar dashboards, relatórios e o assistente de chat.

### Backend (Novo serviço)

Um serviço **FastAPI** centraliza o acesso aos modelos generativos e ao mecanismo de RAG:
*   Indexação de relatórios fiscais em um **ChromaDB** persistente para consultas posteriores.
*   Respostas do chat consultivo combinando recuperação (RAG) e modelos Gemini/DeepSeek, com suporte a **streaming via SSE**.
*   Endpoint genérico `/api/v1/llm/generate-json` para demais agentes solicitarem respostas em JSON, preservando o schema definido no frontend.
*   Toda a configuração sensível de chaves (ex.: `GEMINI_API_KEY`) fica restrita às variáveis de ambiente do backend.

---

##  Blueprint para Backend de Produção

Para uma solução escalável em produção, a arquitetura pode evoluir para um sistema cliente-servidor, desacoplando a interface do processamento pesado.

#### Stack Tecnológico Sugerido
*   **Framework:** Python 3.11+ com FastAPI.
*   **Processamento Assíncrono:** Celery com RabbitMQ como message broker e Redis para cache.
*   **Orquestração de Agentes:** Orquestrador baseado em state machine (LangGraph opcional).
*   **Banco de Dados:** PostgreSQL para metadados, regras e logs de auditoria.
*   **Armazenamento de Arquivos:** S3-compatible (MinIO).
*   **Inteligência Artificial:** Google Gemini API (`gemini-2.5-flash`).
*   **Observabilidade:** Padrão OpenTelemetry (OTLP) para tracing, métricas e logs.

#### Sistema Multiagente no Backend

*   **Orquestrador:** Gerencia o fluxo de trabalho (Saga pattern), garantindo a execução resiliente e a compensação de falhas.
*   **ExtractorAgent:** Ingestão de dados brutos (XML, PDF, Imagens) via fila, usando OCR/parsing para extrair dados estruturados.
*   **AuditorAgent:** Aplica um motor de regras fiscais para validar os dados e calcula um score de risco.
*   **ClassifierAgent:** Categoriza os documentos por tipo de operação e setor.
*   **AccountantAgent:** Automatiza lançamentos contábeis, apura impostos e gera o arquivo SPED.
*   **IntelligenceAgent:** Gera insights gerenciais, alimenta o RAG para o chat e responde a simulações.

---

## ✅ Qualidade e Automação (Metas de Produção)

O projeto adere a um rigoroso padrão de qualidade, imposto por automação no pipeline de CI/CD:

*   **Spec-as-Tests:** Testes de aceitação são derivados diretamente das especificações funcionais. Um conjunto de requisitos críticos **deve passar 100%** para que o deploy seja autorizado.
*   **CI/CD Gates:** O pipeline de integração contínua possui gates de qualidade automáticos, incluindo:
    *   **Cobertura de Testes:** Mínimo de 85%.
    *   **Testes de Performance:** Verificação de latência (P95 < 1200ms) e taxa de erro (< 2%) com k6.
    *   **Análise de Segurança:** Verificação de vulnerabilidades estáticas e de dependências.
*   **AutoFix:** Capacidade de utilizar IA para diagnosticar e propor correções para testes que falham, acelerando o ciclo de desenvolvimento.

---

## 🚀 Execução do Frontend

### No AI Studio
1. Clique no botão "Run" ou "Executar".
2. Uma nova aba será aberta com a aplicação em funcionamento.

### Backend
1. **Instale as dependências Python:**
   ```bash
   pip install -r backend/requirements.txt
   ```
2. **Configure as variáveis de ambiente:** crie um arquivo `.env` na pasta `backend/` ou exporte diretamente as seguintes chaves:
   ```env
   GEMINI_API_KEY="sua-chave-do-gemini"
   # Opcional: altere o diretório do ChromaDB ou utilize DeepSeek definindo LLM_PROVIDER=deepseek e DEEPSEEK_API_KEY.
   ```
3. **Inicie o servidor FastAPI:**
   ```bash
   uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
   ```
4. **Verifique a saúde da API:** `http://localhost:8000/health`.

### Frontend
1. **Clone o repositório.**
2. **Configure as variáveis do Vite:** crie um arquivo `.env.local` na raiz contendo, no mínimo:
   ```env
   VITE_BACKEND_URL="http://localhost:8000"
   ```
3. **Instale as dependências e inicie o servidor de desenvolvimento:**
   ```bash
   npm install
   npm run dev
   ```
4. Acesse a URL fornecida (geralmente `http://localhost:5173`). O frontend comunicará o backend para realizar buscas, gerar insights e responder ao chat.

---

## 📁 Estrutura de Pastas

```
/
├── backend/
│   ├── agents/            # Agentes e lógica de RAG (ConsultantAgent)
│   ├── api/               # Endpoints FastAPI (chat e LLM genérico)
│   ├── core/              # Configuração (variáveis de ambiente)
│   ├── services/          # Cliente LLM compartilhado (Gemini/DeepSeek)
│   ├── main.py            # Ponto de entrada FastAPI
│   └── requirements.txt   # Dependências Python
├── agents/                # Agentes executados no frontend
├── components/            # Componentes React reutilizáveis
├── hooks/                 # Hooks React customizados (ex: useAgentOrchestrator)
├── services/              # Serviços (requisições ao backend, logger)
├── utils/                 # Funções utilitárias (parsers, exportação, regras)
├── App.tsx                # Componente principal da aplicação
├── index.html             # Arquivo HTML principal
└── README.md              # Este arquivo
```
