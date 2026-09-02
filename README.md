# Radar de Compradores V2

Evolução do MVP "Intenção Pública / Radar de Compradores".

## O que já está implementado nesta Fase 1

- visual inspirado na prévia original;
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
- histórico de execuções preparado;
- tela de integrações preparada para HasData;
- persistência local no navegador para testes;
- migration SQL do Supabase com RLS, inclusive para sinais dos leads, para a próxima etapa.

## Rodar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Próxima etapa — Fase 2

1. conectar o projeto a um Supabase real;
2. substituir localStorage por persistência autenticada;
3. adicionar `HASDATA_API_KEY` somente no servidor;
4. criar gerador de consultas por campanha;
5. implementar `Buscar agora`;
6. deduplicar e classificar cada resultado retornado;
7. preencher a aba Execuções com custos/contagens reais.

## Segurança de configuração

Nunca exponha `HASDATA_API_KEY` ou `SUPABASE_SERVICE_ROLE_KEY` no cliente. Use variáveis de ambiente do servidor/Vercel.
