"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Check, ChevronRight, CircleDot, ExternalLink, Flame, History, Inbox, Megaphone, Plus, Search, Settings2, Sparkles, Target, Trash2 } from "lucide-react";
import { analyzeText } from "@/lib/scoring";
import { createFingerprint } from "@/lib/dedupe";
import { initialCampaigns, initialLeads, initialRuns } from "@/lib/seed";
import { Campaign, Lead, LeadStatus, SearchRun, Source } from "@/lib/types";

type Tab = "radar" | "campaigns" | "analyze" | "runs" | "integrations";
const STORE = "radar-compradores-v2-state";

function scoreClass(score: number) { return score >= 80 ? "score score-hot" : score >= 55 ? "score score-warm" : "score score-cold"; }
function relativeDate(iso: string) {
  const min = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60); if (h < 24) return `há ${h} h`;
  return `há ${Math.round(h / 24)} d`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("radar");
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns);
  const [leads, setLeads] = useState<Lead[]>(initialLeads);
  const [runs] = useState<SearchRun[]>(initialRuns);
  const [hydrated, setHydrated] = useState(false);
  const [campaignId, setCampaignId] = useState(initialCampaigns[0].id);
  const [statusFilter, setStatusFilter] = useState<"Todos" | LeadStatus>("Todos");
  const [sourceFilter, setSourceFilter] = useState<"Todas" | Source>("Todas");
  const [scoreFilter, setScoreFilter] = useState("0");
  const [query, setQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [form, setForm] = useState({ source: "Facebook" as Source, profileName: "", publicationUrl: "", publicationText: "", publishedAt: new Date().toISOString().slice(0,16) });
  const [campaignForm, setCampaignForm] = useState({ name: "", location: "Brasil", products: "", intent: "", negative: "", minimumScore: 55 });

  useEffect(() => {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      try { const parsed = JSON.parse(raw); setCampaigns(parsed.campaigns ?? initialCampaigns); setLeads(parsed.leads ?? initialLeads); } catch {}
    }
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) localStorage.setItem(STORE, JSON.stringify({ campaigns, leads }));
  }, [campaigns, leads, hydrated]);

  const currentCampaign = campaigns.find(c => c.id === campaignId) ?? campaigns[0];
  const filtered = useMemo(() => leads.filter(l => {
    if (campaignId && l.campaignId !== campaignId) return false;
    if (statusFilter !== "Todos" && l.status !== statusFilter) return false;
    if (sourceFilter !== "Todas" && l.source !== sourceFilter) return false;
    if (l.analysis.score < Number(scoreFilter)) return false;
    if (query && !`${l.profileName} ${l.publicationText} ${l.analysis.product ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }).sort((a,b) => b.analysis.score - a.analysis.score), [leads, campaignId, statusFilter, sourceFilter, scoreFilter, query]);

  const metrics = {
    total: leads.filter(l => l.campaignId === campaignId).length,
    hot: leads.filter(l => l.campaignId === campaignId && l.analysis.score >= 80).length,
    review: leads.filter(l => l.campaignId === campaignId && l.status === "Novo").length,
    converted: leads.filter(l => l.campaignId === campaignId && l.status === "Convertido").length,
  };

  function updateStatus(id: string, status: LeadStatus) {
    setLeads(old => old.map(l => l.id === id ? { ...l, status } : l));
    setSelectedLead(old => old?.id === id ? { ...old, status } : old);
  }

  function saveAnalysis() {
    if (!form.publicationText.trim() || !currentCampaign) return;
    const analysis = analyzeText(form.publicationText, currentCampaign, new Date(form.publishedAt).toISOString());
    const fp = createFingerprint(form.source, form.publicationUrl, form.publicationText);
    if (leads.some(l => l.fingerprint === fp)) { alert("Esta publicação já está no Radar."); return; }
    const lead: Lead = {
      id: crypto.randomUUID(), campaignId: currentCampaign.id, source: form.source, profileName: form.profileName || "Perfil público",
      publicationUrl: form.publicationUrl || "#", publicationText: form.publicationText, publishedAt: new Date(form.publishedAt).toISOString(),
      createdAt: new Date().toISOString(), status: "Novo", analysis, fingerprint: fp,
    };
    setLeads(old => [lead, ...old]); setSelectedLead(lead); setTab("radar");
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
    setCampaigns(old => [...old, c]); setCampaignId(c.id); setCampaignForm({ name:"", location:"Brasil", products:"", intent:"", negative:"", minimumScore:55 }); setTab("radar");
  }

  return <main>
    <header className="topbar"><div className="brand"><div className="logo"><Target size={20}/></div><div><span>INTENÇÃO PÚBLICA</span><strong>Radar de Compradores <b>V2</b></strong></div></div><button className="btn primary" onClick={()=>setTab("campaigns")}><Plus size={17}/> Nova campanha</button></header>
    <div className="wrap">
      <section className="hero"><div><div className="eyebrow"><Activity size={16}/> MONITORAMENTO PESSOAL</div><h1>Encontre quem já demonstrou vontade de comprar.</h1><p>Priorize sinais públicos de compra, entenda por que foram classificados e revise pessoalmente cada oportunidade.</p></div><div className="hero-actions"><select value={campaignId} onChange={e=>setCampaignId(e.target.value)}>{campaigns.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><button className="btn lime" onClick={()=>setTab("integrations")}><Search size={17}/> Buscar agora</button></div></section>
      <nav className="tabs">
        <button className={tab==="radar"?"active":""} onClick={()=>setTab("radar")}><Target size={16}/>Radar</button>
        <button className={tab==="campaigns"?"active":""} onClick={()=>setTab("campaigns")}><Megaphone size={16}/>Campanhas</button>
        <button className={tab==="analyze"?"active":""} onClick={()=>setTab("analyze")}><Inbox size={16}/>Analisar publicação</button>
        <button className={tab==="runs"?"active":""} onClick={()=>setTab("runs")}><History size={16}/>Execuções</button>
        <button className={tab==="integrations"?"active":""} onClick={()=>setTab("integrations")}><Settings2 size={16}/>Integrações</button>
      </nav>

      {tab === "radar" && <>
        <section className="metrics"><Metric label="Candidatos encontrados" value={metrics.total} icon={<CircleDot/>}/><Metric label="Intenção alta" value={metrics.hot} icon={<Flame/>}/><Metric label="Aguardando revisão" value={metrics.review} icon={<Sparkles/>}/><Metric label="Convertidos" value={metrics.converted} icon={<Check/>}/></section>
        <section className="panel">
          <div className="panel-head"><div><h2>Possíveis compradores</h2><p>Resultados ordenados pela maior oportunidade.</p></div><button className="btn subtle" onClick={()=>setTab("analyze")}><Plus size={16}/> Adicionar publicação</button></div>
          <div className="filters"><input placeholder="Buscar perfil, produto ou texto..." value={query} onChange={e=>setQuery(e.target.value)}/><select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value as any)}><option>Todas</option>{["Facebook","Instagram","TikTok","Reddit","Web"].map(x=><option key={x}>{x}</option>)}</select><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value as any)}><option>Todos</option>{["Novo","Revisado","Contatado","Convertido","Descartado"].map(x=><option key={x}>{x}</option>)}</select><select value={scoreFilter} onChange={e=>setScoreFilter(e.target.value)}><option value="0">Qualquer score</option><option value="55">55+</option><option value="80">80+</option></select></div>
          <div className="lead-list">{filtered.length===0?<div className="empty">Nenhum resultado para estes filtros.</div>:filtered.map(l=><article className="lead" key={l.id} onClick={()=>setSelectedLead(l)}><div className={scoreClass(l.analysis.score)}>{l.analysis.score}</div><div className="lead-main"><div className="lead-meta"><strong>{l.profileName}</strong><span>{l.source} · {relativeDate(l.publishedAt)}</span></div><p>{l.publicationText}</p><div className="chips"><span>{l.analysis.band}</span>{l.analysis.product&&<span>{l.analysis.product}</span>}{l.analysis.budget&&<span>até R$ {l.analysis.budget.toLocaleString("pt-BR")}</span>}</div></div><select value={l.status} onClick={e=>e.stopPropagation()} onChange={e=>updateStatus(l.id,e.target.value as LeadStatus)}>{["Novo","Revisado","Contatado","Convertido","Descartado"].map(s=><option key={s}>{s}</option>)}</select><ChevronRight size={18}/></article>)}</div>
        </section>
      </>}

      {tab === "campaigns" && <section className="campaign-grid"><div>{campaigns.map(c=><article className="campaign-card" key={c.id}><div className="card-top"><div><h2>{c.name}</h2><p>{c.location}</p></div><span className="badge ok">{c.active?"Ativa":"Pausada"}</span></div><Label title="PRODUTOS" items={c.products}/><Label title="FRASES DE INTENÇÃO" items={c.intentPhrases}/><Label title="NEGATIVAS" items={c.negativeKeywords}/><p className="sources">Fontes: {c.sources.join(", ")} · Score mínimo: {c.minimumScore}</p><div className="row"><button className="btn subtle" onClick={()=>{setCampaignId(c.id);setTab("radar")}}>Usar no radar</button><button className="icon-btn" title="Excluir" onClick={()=>deleteCampaign(c.id)}><Trash2 size={17}/></button></div></article>)}</div><div className="panel create"><h2>Criar nova campanha</h2><p>Defina produto, sinais positivos e exclusões.</p><input placeholder="Nome da campanha" value={campaignForm.name} onChange={e=>setCampaignForm({...campaignForm,name:e.target.value})}/><input placeholder="Localização" value={campaignForm.location} onChange={e=>setCampaignForm({...campaignForm,location:e.target.value})}/><textarea placeholder="Produtos, separados por vírgula" value={campaignForm.products} onChange={e=>setCampaignForm({...campaignForm,products:e.target.value})}/><textarea placeholder="Frases de intenção, separadas por vírgula" value={campaignForm.intent} onChange={e=>setCampaignForm({...campaignForm,intent:e.target.value})}/><textarea placeholder="Palavras negativas, separadas por vírgula" value={campaignForm.negative} onChange={e=>setCampaignForm({...campaignForm,negative:e.target.value})}/><label>Score mínimo: <b>{campaignForm.minimumScore}</b></label><input type="range" min="0" max="100" value={campaignForm.minimumScore} onChange={e=>setCampaignForm({...campaignForm,minimumScore:Number(e.target.value)})}/><button className="btn primary" onClick={createCampaign}><Plus size={16}/>Criar campanha</button></div></section>}

      {tab === "analyze" && <section className="two-cols"><div className="panel"><h2>Analisar uma publicação pública</h2><p>Cole o conteúdo encontrado. A V2 calcula intenção, relevância e recência e evita duplicatas.</p><div className="form-grid"><label>Rede social<select value={form.source} onChange={e=>setForm({...form,source:e.target.value as Source})}>{["Facebook","Instagram","TikTok","Reddit","Web"].map(x=><option key={x}>{x}</option>)}</select></label><label>Nome público do perfil<input placeholder="Ex.: Maria S." value={form.profileName} onChange={e=>setForm({...form,profileName:e.target.value})}/></label></div><label>Link da publicação<input placeholder="https://..." value={form.publicationUrl} onChange={e=>setForm({...form,publicationUrl:e.target.value})}/></label><label>Data/hora da publicação<input type="datetime-local" value={form.publishedAt} onChange={e=>setForm({...form,publishedAt:e.target.value})}/></label><label>Texto da publicação ou comentário<textarea className="big" placeholder="Ex.: Alguém sabe onde comprar uma air fryer boa e barata?" value={form.publicationText} onChange={e=>setForm({...form,publicationText:e.target.value})}/></label><button className="btn primary" onClick={saveAnalysis}><Sparkles size={16}/>Analisar e salvar</button></div><ScoringHelp/></section>}

      {tab === "runs" && <section className="panel"><h2>Execuções</h2><p>Histórico de buscas automáticas. Será preenchido na Fase 2.</p><div className="run-table"><div className="run row-head"><span>Data</span><span>Campanha</span><span>Consultas</span><span>Encontrados</span><span>Salvos</span><span>Status</span></div>{runs.map(r=><div className="run" key={r.id}><span>{new Date(r.startedAt).toLocaleString("pt-BR")}</span><span>{campaigns.find(c=>c.id===r.campaignId)?.name}</span><span>{r.queries}</span><span>{r.found}</span><span>{r.saved}</span><span className="badge">{r.status}</span></div>)}</div></section>}

      {tab === "integrations" && <section><div className="notice"><Check size={18}/><div><strong>Uso pessoal e revisão humana</strong><p>A ferramenta organiza conteúdo público. Nenhuma mensagem é enviada e ninguém é incluído em grupos automaticamente.</p></div></div><div className="integration-grid"><Integration title="Busca pública" state="Preparada" text="HasData / Google. A API será conectada na Fase 2 e alimentará o histórico de execuções."/><Integration title="Página do Facebook" state="Próxima etapa" text="Somente conteúdo e permissões autorizadas pela Meta."/><Integration title="Importação manual" state="Ativa" text="Cole qualquer publicação pública encontrada e use agora o classificador V2."/></div></section>}
    </div>
    {selectedLead && <div className="modal-backdrop" onClick={()=>setSelectedLead(null)}><aside className="drawer" onClick={e=>e.stopPropagation()}><button className="close" onClick={()=>setSelectedLead(null)}>×</button><div className={scoreClass(selectedLead.analysis.score)}>{selectedLead.analysis.score}</div><h2>{selectedLead.analysis.band}</h2><p className="muted">{selectedLead.source} · {relativeDate(selectedLead.publishedAt)}</p><blockquote>{selectedLead.publicationText}</blockquote><h3>Por que foi classificado?</h3><ul>{selectedLead.analysis.signals.map(s=><li key={s}><Check size={15}/>{s}</li>)}</ul><div className="detail-grid"><div><span>Relevância</span><b>{selectedLead.analysis.relevance}%</b></div><div><span>Recência</span><b>{selectedLead.analysis.recencyWeight}%</b></div><div><span>Produto</span><b>{selectedLead.analysis.product??"—"}</b></div><div><span>Urgência</span><b>{selectedLead.analysis.urgency??"—"}</b></div></div><label>Situação<select value={selectedLead.status} onChange={e=>updateStatus(selectedLead.id,e.target.value as LeadStatus)}>{["Novo","Revisado","Contatado","Convertido","Descartado"].map(s=><option key={s}>{s}</option>)}</select></label>{selectedLead.publicationUrl!=="#"&&<a className="btn primary link" href={selectedLead.publicationUrl} target="_blank" rel="noreferrer">Abrir publicação <ExternalLink size={16}/></a>}</aside></div>}
  </main>
}

function Metric({label,value,icon}:{label:string,value:number,icon:React.ReactNode}) { return <div className="metric"><div><span>{label}</span><strong>{value}</strong></div><div className="metric-icon">{icon}</div></div> }
function Label({title,items}:{title:string,items:string[]}) { return <div className="label-block"><span>{title}</span><div className="chips">{items.length?items.map(x=><em key={x}>{x}</em>):<em>não definido</em>}</div></div> }
function ScoringHelp(){return <aside className="help"><h2>Como a pontuação funciona</h2><p>O sistema considera a frase inteira e combina três dimensões.</p><div><b>Intenção</b><span>Quer comprar, pede preço, link ou recomendação.</span></div><div><b>Relevância</b><span>O produto corresponde à campanha selecionada.</span></div><div><b>Recência</b><span>Publicações recentes recebem mais prioridade.</span></div><div className="bands"><p><strong>80–100</strong> · intenção alta</p><p><strong>55–79</strong> · possível comprador</p><p><strong>0–54</strong> · sinal fraco</p></div></aside>}
function Integration({title,state,text}:{title:string,state:string,text:string}){return <article className="integration"><div className="card-top"><h2>{title}</h2><span className="badge">{state}</span></div><p>{text}</p></article>}
