"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronRight, CircleDot, ExternalLink, Flame, History, Inbox, Megaphone, Plus, Search, Settings2, Sparkles, Target, Trash2 } from "lucide-react";
import { analyzeText } from "@/lib/scoring";
import { createFingerprint } from "@/lib/dedupe";
import { initialCampaigns, initialLeads, initialRuns } from "@/lib/seed";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { Campaign, Lead, LeadStatus, SearchRun, Source } from "@/lib/types";

type Tab = "radar" | "campaigns" | "analyze" | "runs" | "integrations";
type LeadView = "qualified" | "weak" | "all";
type LeadTypeFilter = "Todos" | "Comentários" | "Publicações";
const STORE = "radar-compradores-v2-state";

type SearchApiResult = {
  queryCount?: number;
  found?: number;
  qualified?: number;
  commentsFound?: number;
  commentPagesChecked?: number;
  elapsedMs?: number;
  warnings?: string[];
  error?: string;
  results?: Array<{
    source: Source;
    profileName: string;
    publicationUrl: string;
    publicationText: string;
    publishedAt?: string | null;
    kind?: "publication" | "comment";
  }>;
};

function scoreClass(score: number) { return score >= 80 ? "score score-hot" : score >= 55 ? "score score-warm" : "score score-cold"; }
function relativeDate(iso: string) {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}
function isCommentLeadText(text: string) {
  return text.trim().toLowerCase().startsWith("comentário público em publicação sobre");
}
function commentDisplayText(text: string) {
  if (!isCommentLeadText(text)) return text;
  const match = text.match(/Comentário:\s*(.+)$/i);
  if (match?.[1]) return match[1].trim();
  const colon = text.lastIndexOf(":");
  return colon >= 0 ? text.slice(colon + 1).trim() : text;
}

function dbRunStatus(value: string): SearchRun["status"] {
  if (value === "running") return "Executando";
  if (value === "failed") return "Falhou";
  return "Concluída";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("radar");
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [runs, setRuns] = useState<SearchRun[]>(initialRuns);
  const [hydrated, setHydrated] = useState(false);
  const [campaignId, setCampaignId] = useState(initialCampaigns[0]?.id ?? "");
  const [leadView, setLeadView] = useState<LeadView>("qualified");
  const [statusFilter, setStatusFilter] = useState<"Todos" | LeadStatus>("Todos");
  const [sourceFilter, setSourceFilter] = useState<"Todas" | Source>("Todas");
  const [typeFilter, setTypeFilter] = useState<LeadTypeFilter>("Todos");
  const [scoreFilter, setScoreFilter] = useState("0");
  const [query, setQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchNotice, setSearchNotice] = useState("");
  const [form, setForm] = useState({ source: "Facebook" as Source, profileName: "", publicationUrl: "", publicationText: "", publishedAt: new Date().toISOString().slice(0,16) });
  const [campaignForm, setCampaignForm] = useState({ name: "", location: "Brasil", products: "", intent: "", negative: "", minimumScore: 55 });

  useEffect(() => {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        setCampaigns(parsed.campaigns ?? initialCampaigns);
        setLeads(parsed.leads ?? initialLeads);
        setRuns(parsed.runs ?? initialRuns);
        const firstCampaign = (parsed.campaigns ?? initialCampaigns)?.[0];
        if (firstCampaign?.id) setCampaignId(firstCampaign.id);
      } catch {}
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) localStorage.setItem(STORE, JSON.stringify({ campaigns, leads, runs }));
  }, [campaigns, leads, runs, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    let active = true;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session || !active) return;
      const { data, error } = await supabase
        .from("search_runs")
        .select("id,campaign_id,started_at,query_count,results_found,results_saved,status")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error || !active) return;
      setRuns((data ?? []).map((row) => ({
        id: row.id,
        campaignId: row.campaign_id,
        startedAt: row.started_at,
        queries: row.query_count,
        found: row.results_found,
        saved: row.results_saved,
        status: dbRunStatus(row.status),
      })));
    })();

    return () => { active = false; };
  }, [hydrated]);

  const currentCampaign = campaigns.find(c => c.id === campaignId) ?? campaigns[0];
  const minimumScore = currentCampaign?.minimumScore ?? 55;
  const campaignLeads = useMemo(() => leads.filter(l => l.campaignId === campaignId), [leads, campaignId]);
  const filtered = useMemo(() => leads.filter(l => {
    if (campaignId && l.campaignId !== campaignId) return false;
    if (leadView === "qualified" && l.analysis.score < minimumScore) return false;
    if (leadView === "weak" && l.analysis.score >= minimumScore) return false;
    if (statusFilter !== "Todos" && l.status !== statusFilter) return false;
    if (sourceFilter !== "Todas" && l.source !== sourceFilter) return false;
    const commentLead = isCommentLeadText(l.publicationText);
    if (typeFilter === "Comentários" && !commentLead) return false;
    if (typeFilter === "Publicações" && commentLead) return false;
    if (l.analysis.score < Number(scoreFilter)) return false;
    if (query && !`${l.profileName} ${l.publicationText} ${l.analysis.product ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }).sort((a,b) => b.analysis.score - a.analysis.score), [leads, campaignId, leadView, minimumScore, statusFilter, sourceFilter, typeFilter, scoreFilter, query]);

  const metrics = {
    qualified: campaignLeads.filter(l => l.analysis.score >= minimumScore).length,
    hot: campaignLeads.filter(l => l.analysis.score >= 80).length,
    weak: campaignLeads.filter(l => l.analysis.score < minimumScore).length,
    converted: campaignLeads.filter(l => l.status === "Convertido").length,
  };

  function updateStatus(id: string, status: LeadStatus) {
    setLeads(old => old.map(l => l.id === id ? { ...l, status } : l));
    setSelectedLead(old => old?.id === id ? { ...old, status } : old);
  }

  function saveAnalysis() {
    if (!form.publicationText.trim() || !currentCampaign) return;
    const analysis = analyzeText(form.publicationText, currentCampaign, new Date(form.publishedAt).toISOString(), form.profileName || "Perfil público");
    const fp = createFingerprint(form.source, form.publicationUrl, form.publicationText);
    if (leads.some(l => l.fingerprint === fp)) { alert("Esta publicação já está no Radar."); return; }
    const lead: Lead = {
      id: crypto.randomUUID(), campaignId: currentCampaign.id, source: form.source, profileName: form.profileName || "Perfil público",
      publicationUrl: form.publicationUrl || "#", publicationText: form.publicationText, publishedAt: new Date(form.publishedAt).toISOString(),
      createdAt: new Date().toISOString(), status: "Novo", analysis, fingerprint: fp,
    };
    setLeads(old => [lead, ...old]); setSelectedLead(lead); setLeadView(analysis.score >= minimumScore ? "qualified" : "weak"); setTab("radar");
  }

  async function runPublicSearch() {
    if (searching) return;
    if (!currentCampaign) {
      setSearchNotice("Crie uma campanha antes de executar a busca pública.");
      setTab("campaigns");
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setSearchNotice("Supabase não está configurado neste ambiente.");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) {
      setSearchNotice("Sua sessão expirou. Entre novamente para buscar.");
      return;
    }

    setSearching(true);
    setSearchNotice("Buscando publicações e comentários públicos com sinais de compra...");
    const startedAt = new Date().toISOString();

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ campaign: currentCampaign }),
      });
      const payload = await response.json() as SearchApiResult;
      if (!response.ok) throw new Error(payload.error || `Falha na busca (${response.status}).`);

      const known = new Set(leads.map((lead) => lead.fingerprint));
      const foundAt = new Date().toISOString();
      const imported: Lead[] = [];

      for (const result of payload.results ?? []) {
        const fingerprint = createFingerprint(result.source, result.publicationUrl, result.publicationText);
        if (known.has(fingerprint)) continue;
        const effectivePublishedAt = result.publishedAt ?? undefined;
        const analysis = analyzeText(result.publicationText, currentCampaign, effectivePublishedAt, result.profileName);
        if (analysis.score < currentCampaign.minimumScore) continue;
        known.add(fingerprint);
        imported.push({
          id: crypto.randomUUID(),
          campaignId: currentCampaign.id,
          source: result.source,
          profileName: result.profileName || "Resultado público",
          publicationUrl: result.publicationUrl,
          publicationText: result.publicationText,
          publishedAt: result.publishedAt || foundAt,
          createdAt: foundAt,
          status: "Novo",
          analysis,
          fingerprint,
        });
      }

      if (imported.length) setLeads(old => [...imported, ...old]);

      const runId = crypto.randomUUID();
      const run: SearchRun = {
        id: runId,
        campaignId: currentCampaign.id,
        startedAt,
        queries: payload.queryCount ?? 0,
        found: payload.found ?? 0,
        saved: imported.length,
        status: "Concluída",
      };
      setRuns(old => [run, ...old].slice(0, 50));

      const { error: runError } = await supabase.from("search_runs").insert({
        id: runId,
        user_id: session.user.id,
        campaign_id: currentCampaign.id,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        query_count: payload.queryCount ?? 0,
        results_found: payload.found ?? 0,
        results_saved: imported.length,
        status: "completed",
        error: payload.warnings?.length ? payload.warnings.join(" | ").slice(0, 3000) : null,
      });

      const commentText = payload.commentsFound ? ` ${payload.commentsFound} sinal(is) vieram de comentários públicos em ${payload.commentPagesChecked ?? 0} página(s) analisada(s).` : " Nenhum comentário público atribuível passou pelos filtros nesta execução.";
      const warningText = payload.warnings?.length ? ` ${payload.warnings.length} aviso(s) de fonte.` : "";
      const historyText = runError ? " O Radar funcionou, mas o histórico não pôde ser gravado." : "";
      setSearchNotice(`Busca concluída: ${payload.qualified ?? payload.results?.length ?? 0} resultados qualificados, ${imported.length} novos salvos.${commentText}${warningText}${historyText}`);
      setLeadView("qualified");
      setTab("radar");
    } catch (error) {
      setSearchNotice(error instanceof Error ? error.message : "Falha ao executar a busca pública.");
      setTab("integrations");
    } finally {
      setSearching(false);
    }
  }

  function deleteCampaign(id: string) {
    if (campaigns.length <= 1) return;
    const nextCampaigns = campaigns.filter(c => c.id !== id);
    setCampaigns(nextCampaigns);
    setLeads(old => old.filter(l => l.campaignId !== id));
    if (campaignId === id) setCampaignId(nextCampaigns[0]?.id ?? "");
    if (selectedLead?.campaignId === id) setSelectedLead(null);
  }

  function createCampaign() {
    if (!campaignForm.name.trim() || !campaignForm.products.trim()) return;
    const c: Campaign = {
      id: crypto.randomUUID(), name: campaignForm.name, location: campaignForm.location,
      products: campaignForm.products.split(",").map(x=>x.trim()).filter(Boolean),
      intentPhrases: campaignForm.intent.split(",").map(x=>x.trim()).filter(Boolean),
      negativeKeywords: campaignForm.negative.split(",").map(x=>x.trim()).filter(Boolean),
      sources: ["Facebook","Instagram","TikTok","Reddit","Web"], minimumScore: campaignForm.minimumScore, active: true,
    };
    setCampaigns(old => [...old, c]); setCampaignId(c.id); setCampaignForm({ name:"", location:"Brasil", products:"", intent:"", negative:"", minimumScore:55 }); setLeadView("qualified"); setTab("radar");
  }

  const listTitle = leadView === "qualified" ? "Leads qualificados" : leadView === "weak" ? "Sinais fracos / histórico" : "Todos os resultados";
  const listSubtitle = leadView === "qualified"
    ? `Somente resultados com score igual ou superior ao mínimo da campanha (${minimumScore}).`
    : leadView === "weak"
      ? `Resultados abaixo de ${minimumScore}, mantidos para auditoria e ajuste do classificador.`
      : "Qualificados e sinais fracos juntos.";

  return <main>
    <header className="topbar"><div className="brand"><div className="logo"><Target size={20}/></div><div><span>INTENÇÃO PÚBLICA</span><strong>Radar de Compradores <b>V2</b></strong></div></div><button className="btn primary" onClick={()=>setTab("campaigns")}><Plus size={17}/> Nova campanha</button></header>
    <div className="wrap">
      <section className="hero"><div><div className="eyebrow"><Activity size={16}/> MONITORAMENTO PESSOAL</div><h1>Encontre quem já demonstrou vontade de comprar.</h1><p>Priorize sinais públicos de compra, inclusive comentários públicos atribuíveis, e revise pessoalmente cada oportunidade.</p></div><div className="hero-actions"><select value={campaignId} onChange={e=>{setCampaignId(e.target.value);setLeadView("qualified")}}>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="btn lime" disabled={searching || !currentCampaign} onClick={runPublicSearch}><Search size={17}/> {searching ? "Buscando..." : "Buscar agora"}</button></div></section>
      <nav className="tabs">
        <button className={tab==="radar"?"active":""} onClick={()=>setTab("radar")}><Target size={16}/>Radar</button>
        <button className={tab==="campaigns"?"active":""} onClick={()=>setTab("campaigns")}><Megaphone size={16}/>Campanhas</button>
        <button className={tab==="analyze"?"active":""} onClick={()=>setTab("analyze")}><Inbox size={16}/>Analisar publicação</button>
        <button className={tab==="runs"?"active":""} onClick={()=>setTab("runs")}><History size={16}/>Execuções</button>
        <button className={tab==="integrations"?"active":""} onClick={()=>setTab("integrations")}><Settings2 size={16}/>Integrações</button>
      </nav>

      {searchNotice && <div className="notice"><Search size={18}/><div><strong>Busca pública</strong><p>{searchNotice}</p></div></div>}

      {tab === "radar" && <>
        <section className="metrics"><Metric label="Leads qualificados" value={metrics.qualified} icon={<CircleDot/>}/><Metric label="Intenção alta" value={metrics.hot} icon={<Flame/>}/><Metric label="Sinais fracos" value={metrics.weak} icon={<Sparkles/>}/><Metric label="Convertidos" value={metrics.converted} icon={<Check/>}/></section>
        <section className="panel">
          <div className="panel-head"><div><h2>{listTitle}</h2><p>{listSubtitle}</p></div><button className="btn subtle" onClick={()=>setTab("analyze")}><Plus size={16}/> Adicionar publicação</button></div>
          <div className="row" style={{marginBottom:12, gap:8, flexWrap:"wrap"}}>
            <button className={`btn ${leadView==="qualified"?"primary":"subtle"}`} onClick={()=>setLeadView("qualified")}>Qualificados ({metrics.qualified})</button>
            <button className={`btn ${leadView==="weak"?"primary":"subtle"}`} onClick={()=>setLeadView("weak")}>Sinais fracos ({metrics.weak})</button>
            <button className={`btn ${leadView==="all"?"primary":"subtle"}`} onClick={()=>setLeadView("all")}>Todos ({campaignLeads.length})</button>
          </div>
          <div className="filters"><input placeholder="Buscar usuário, comentário, produto ou texto..." value={query} onChange={e=>setQuery(e.target.value)}/><select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value as any)}><option>Todas</option>{["Facebook","Instagram","TikTok","Reddit","Web"].map(x=><option key={x}>{x}</option>)}</select><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value as LeadTypeFilter)}><option>Todos</option><option>Comentários</option><option>Publicações</option></select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)}><option>Todos</option>{["Novo","Revisado","Contatado","Convertido","Descartado"].map(x=><option key={x}>{x}</option>)}</select><select value={scoreFilter} onChange={e=>setScoreFilter(e.target.value)}><option value="0">Qualquer score</option><option value="55">55+</option><option value="80">80+</option></select></div>
          <div className="lead-list">{filtered.length===0?<div className="empty">Nenhum resultado para estes filtros.</div>:filtered.map(l=>{const commentLead=isCommentLeadText(l.publicationText);return <article className="lead" key={l.id} onClick={()=>setSelectedLead(l)}><div className={scoreClass(l.analysis.score)}>{l.analysis.score}</div><div className="lead-main"><div className="lead-meta"><strong>{l.profileName}</strong><span>{l.source} · {relativeDate(l.publishedAt)}</span></div><p>{commentLead?<><b>Comentário:</b> {commentDisplayText(l.publicationText)}</>:l.publicationText}</p><div className="chips"><span>{l.analysis.band}</span>{commentLead?<span>💬 Comentário</span>:<span>📝 Publicação</span>}{l.analysis.product&&<span>{l.analysis.product}</span>}{l.analysis.budget&&<span>até R$ {l.analysis.budget.toLocaleString("pt-BR")}</span>}</div></div><select value={l.status} onClick={e=>e.stopPropagation()} onChange={e=>updateStatus(l.id,e.target.value as LeadStatus)}>{["Novo","Revisado","Contatado","Convertido","Descartado"].map(s=><option key={s}>{s}</option>)}</select><ChevronRight size={18}/></article>})}</div>
        </section>
      </>}

      {tab === "campaigns" && <section className="campaign-grid"><div>{campaigns.map(c=><article className="campaign-card" key={c.id}><div className="card-top"><div><h2>{c.name}</h2><p>{c.location}</p></div><span className="badge ok">{c.active?"Ativa":"Pausada"}</span></div><Label title="PRODUTOS" items={c.products}/><Label title="FRASES DE INTENÇÃO" items={c.intentPhrases}/><Label title="NEGATIVAS" items={c.negativeKeywords}/><p className="sources">Fontes: {c.sources.join(", ")} · Score mínimo: {c.minimumScore}</p><div className="row"><button className="btn subtle" onClick={()=>{setCampaignId(c.id);setLeadView("qualified");setTab("radar")}}>Usar no radar</button><button className="icon-btn" title="Excluir" onClick={()=>deleteCampaign(c.id)}><Trash2 size={17}/></button></div></article>)}</div><div className="panel create"><h2>Criar nova campanha</h2><p>Defina produto, sinais positivos e exclusões.</p><input placeholder="Nome da campanha" value={campaignForm.name} onChange={e=>setCampaignForm({...campaignForm,name:e.target.value})}/><input placeholder="Localização" value={campaignForm.location} onChange={e=>setCampaignForm({...campaignForm,location:e.target.value})}/><textarea placeholder="Produtos, separados por vírgula" value={campaignForm.products} onChange={e=>setCampaignForm({...campaignForm,products:e.target.value})}/><textarea placeholder="Frases de intenção, separadas por vírgula" value={campaignForm.intent} onChange={e=>setCampaignForm({...campaignForm,intent:e.target.value})}/><textarea placeholder="Palavras negativas, separadas por vírgula" value={campaignForm.negative} onChange={e=>setCampaignForm({...campaignForm,negative:e.target.value})}/><label>Score mínimo: <b>{campaignForm.minimumScore}</b></label><input type="range" min="0" max="100" value={campaignForm.minimumScore} onChange={e=>setCampaignForm({...campaignForm,minimumScore:Number(e.target.value)})}/><button className="btn primary" onClick={createCampaign}><Plus size={16}/>Criar campanha</button></div></section>}

      {tab === "analyze" && <section className="two-cols"><div className="panel"><h2>Analisar uma publicação pública</h2><p>Cole o conteúdo encontrado. A V2 calcula intenção, relevância e recência e evita duplicatas.</p><div className="form-grid"><label>Rede social<select value={form.source} onChange={e=>setForm({...form,source:e.target.value as Source})}>{["Facebook","Instagram","TikTok","Reddit","Web"].map(x=><option key={x}>{x}</option>)}</select></label><label>Nome público do perfil<input placeholder="Ex.: Maria S." value={form.profileName} onChange={e=>setForm({...form,profileName:e.target.value})}/></label></div><label>Link da publicação<input placeholder="https://..." value={form.publicationUrl} onChange={e=>setForm({...form,publicationUrl:e.target.value})}/></label><label>Data/hora da publicação<input type="datetime-local" value={form.publishedAt} onChange={e=>setForm({...form,publishedAt:e.target.value})}/></label><label>Texto da publicação ou comentário<textarea className="big" placeholder="Ex.: Alguém sabe onde comprar uma air fryer boa e barata?" value={form.publicationText} onChange={e=>setForm({...form,publicationText:e.target.value})}/></label><button className="btn primary" onClick={saveAnalysis}><Sparkles size={16}/>Analisar e salvar</button></div><ScoringHelp/></section>}

      {tab === "runs" && <section className="panel"><h2>Execuções</h2><p>Histórico das buscas públicas executadas para suas campanhas.</p><div className="run-table"><div className="run row-head"><span>Data</span><span>Campanha</span><span>Consultas</span><span>Encontrados</span><span>Salvos</span><span>Status</span></div>{runs.length===0?<div className="empty">Nenhuma busca automática executada ainda.</div>:runs.map(r=><div className="run" key={r.id}><span>{new Date(r.startedAt).toLocaleString("pt-BR")}</span><span>{campaigns.find(c=>c.id===r.campaignId)?.name ?? "Campanha removida"}</span><span>{r.queries}</span><span>{r.found}</span><span>{r.saved}</span><span className="badge">{r.status}</span></div>)}</div></section>}

      {tab === "integrations" && <section><div className="notice"><Check size={18}/><div><strong>Uso pessoal e revisão humana</strong><p>A ferramenta organiza somente conteúdo público. Nenhuma mensagem é enviada e ninguém é incluído em grupos automaticamente.</p></div></div><div className="integration-grid"><Integration title="Busca pública" state="Ativa" text="HasData / Google SERP para localizar publicações públicas relevantes. Facebook prioriza resultados dos últimos 30 dias, mais recentes primeiro."/><Integration title="Comentários públicos" state="Beta" text="Facebook: até duas publicações públicas recentes por busca, somente comentários visíveis e com autor separado da página. Instagram: tentativa em conteúdo visível sem login. Autoria incerta é descartada."/><Integration title="Importação manual" state="Ativa" text="Cole qualquer publicação ou comentário público encontrado e use o classificador V2."/></div></section>}
    </div>
    {selectedLead && <div className="modal-backdrop" onClick={()=>setSelectedLead(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelectedLead(null)}>×</button><div className={scoreClass(selectedLead.analysis.score)}>{selectedLead.analysis.score}</div><h2>{selectedLead.analysis.band}</h2><p className="muted">{selectedLead.source} · {relativeDate(selectedLead.publishedAt)} · {isCommentLeadText(selectedLead.publicationText)?"💬 Comentário":"📝 Publicação"}</p>{isCommentLeadText(selectedLead.publicationText)&&<p className="muted"><b>Usuário/comentarista:</b> {selectedLead.profileName}</p>}<blockquote>{isCommentLeadText(selectedLead.publicationText)?commentDisplayText(selectedLead.publicationText):selectedLead.publicationText}</blockquote><h3>Por que foi classificado?</h3><ul>{selectedLead.analysis.signals.map(s=><li key={s}><Check size={15}/>{s}</li>)}</ul><div className="detail-grid"><div><span>Relevância</span><b>{selectedLead.analysis.relevance}%</b></div><div><span>Recência</span><b>{selectedLead.analysis.recencyWeight}%</b></div><div><span>Produto</span><b>{selectedLead.analysis.product??"—"}</b></div><div><span>Urgência</span><b>{selectedLead.analysis.urgency??"—"}</b></div></div><label>Situação<select value={selectedLead.status} onChange={e=>updateStatus(selectedLead.id,e.target.value as LeadStatus)}>{["Novo","Revisado","Contatado","Convertido","Descartado"].map(s=><option key={s}>{s}</option>)}</select></label>{selectedLead.publicationUrl!=="#"&&<a className="btn primary link" href={selectedLead.publicationUrl} target="_blank" rel="noreferrer">Abrir publicação <ExternalLink size={16}/></a>}</aside></div>}
  </main>
}

function Metric({label,value,icon}:{label:string,value:number,icon:React.ReactNode}) { return <div className="metric"><div><span>{label}</span><strong>{value}</strong></div><div className="metric-icon">{icon}</div></div> }
function Label({title,items}:{title:string,items:string[]}) { return <div className="label-block"><span>{title}</span><div className="chips">{items.length?items.map(x=><em key={x}>{x}</em>):<em>não definido</em>}</div></div> }
function ScoringHelp(){return <aside className="help"><h2>Como a pontuação funciona</h2><p>O sistema considera a frase inteira e combina três dimensões.</p><div><b>Intenção</b><span>Quer comprar, pede preço, link ou recomendação. Comentários curtos como “eu quero” só recebem peso alto quando o produto está confirmado pelo contexto da publicação.</span></div><div><b>Relevância</b><span>O produto corresponde à campanha selecionada.</span></div><div><b>Recência</b><span>Publicações recentes recebem mais prioridade.</span></div><div className="bands"><p><strong>80–100</strong> · intenção alta</p><p><strong>55–79</strong> · possível comprador</p><p><strong>0–54</strong> · sinal fraco</p></div></aside>}
function Integration({title,state,text}:{title:string,state:string,text:string}){return <article className="integration"><div className="card-top"><h2>{title}</h2><span className="badge">{state}</span></div><p>{text}</p></article>}
