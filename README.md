# Radar de Compradores V2

Evolução do MVP "Intenção Pública / Radar de Compradores".

## Estado atual

- visual inspirado na prévia original;
- autenticação por e-mail e senha via Supabase;
- persistência de campanhas e leads com RLS;
- campanhas com produtos, frases de intenção, palavras negativas e score mínimo;
- Radar com filtros por rede, status, score e texto;
- ordenação por maior score;
- detalhe do lead em painel lateral;
- scoring estruturado em **intenção + relevância + recência**;
- frases de intenção personalizadas de cada campanha incorporadas ao classificador;
- extração simples de orçamento e urgência;
- distinção básica comprador x vendedor;
- deduplicação por fingerprint;
- análise manual de publicação;
- histórico de execuções persistido em `search_runs`;
- integração de busca pública HasData/Google SERP no servidor;
- botão **Buscar agora** protegido por sessão do Supabase;
- filtro automático pelo score mínimo da campanha antes de salvar oportunidades.

## Busca pública

A busca usa o endpoint Google SERP da HasData no servidor da Vercel. A chave nunca é enviada ao navegador.

Por execução, o Radar:

1. gera uma consulta por fonte habilitada na campanha;
2. busca resultados públicos;
3. limita o lote a até 50 resultados brutos;
4. remove duplicatas;
5. aplica o classificador do Radar;
6. salva somente resultados com score igual ou superior ao mínimo da campanha;
7. registra contagens e avisos em `search_runs`.

Para ativar a busca, configure na Vercel:

```text
HASDATA_API_KEY=...
```

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Variáveis de ambiente

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
HASDATA_API_KEY=
```

## Segurança

- o repositório pode ser público; nenhuma chave real deve ser versionada;
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` é a chave pública destinada ao cliente e o acesso aos dados é protegido por RLS;
- `HASDATA_API_KEY` deve existir somente no ambiente de servidor/Vercel;
- `SUPABASE_SERVICE_ROLE_KEY` não é necessária para o fluxo atual e não deve ser exposta ao cliente.
