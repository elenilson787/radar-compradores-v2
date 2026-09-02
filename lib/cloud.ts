import type { SupabaseClient } from "@supabase/supabase-js";
import type { Analysis, Campaign, Lead, LeadBand, LeadStatus, SearchRun, Source } from "./types";

type CloudState = {
  campaigns: Campaign[];
  leads: Lead[];
  runs: SearchRun[];
};

function bandFromScore(score: number): LeadBand {
  if (score >= 80) return "Alta intenção";
  if (score >= 55) return "Possível comprador";
  return "Sinal fraco";
}

function runStatus(value: string): SearchRun["status"] {
  if (value === "running") return "Executando";
  if (value === "failed") return "Falhou";
  return "Concluída";
}

export async function loadCloudState(supabase: SupabaseClient): Promise<CloudState> {
  const [campaignsResult, leadsResult, signalsResult, runsResult] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: true }),
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("lead_signals").select("lead_id,signal,weight,reason"),
    supabase.from("search_runs").select("*").order("started_at", { ascending: false }).limit(100),
  ]);

  for (const result of [campaignsResult, leadsResult, signalsResult, runsResult]) {
    if (result.error) throw result.error;
  }

  const signalMap = new Map<string, string[]>();
  for (const row of signalsResult.data ?? []) {
    const list = signalMap.get(row.lead_id) ?? [];
    list.push(row.signal);
    signalMap.set(row.lead_id, list);
  }

  const campaigns: Campaign[] = (campaignsResult.data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    location: row.location,
    products: row.products ?? [],
    intentPhrases: row.intent_phrases ?? [],
    negativeKeywords: row.negative_keywords ?? [],
    sources: (row.sources ?? []) as Source[],
    minimumScore: row.minimum_score,
    active: row.active,
  }));

  const leads: Lead[] = (leadsResult.data ?? []).map((row) => {
    const score = row.score;
    const analysis: Analysis = {
      score,
      band: bandFromScore(score),
      intent: (row.intent ?? "weak") as Analysis["intent"],
      product: row.product,
      budget: row.budget == null ? null : Number(row.budget),
      urgency: row.urgency as Analysis["urgency"],
      relevance: row.relevance,
      recencyWeight: row.recency_weight,
      signals: signalMap.get(row.id) ?? [],
      reason: "Classificação persistida no Supabase.",
    };

    return {
      id: row.id,
      campaignId: row.campaign_id,
      source: row.source as Source,
      profileName: row.profile_name || "Perfil público",
      profileUrl: row.profile_url || undefined,
      publicationUrl: row.publication_url || "#",
      publicationText: row.publication_text,
      publishedAt: row.published_at || row.created_at,
      createdAt: row.created_at,
      status: row.status as LeadStatus,
      analysis,
      fingerprint: row.fingerprint,
    };
  });

  const runs: SearchRun[] = (runsResult.data ?? []).map((row) => ({
    id: row.id,
    campaignId: row.campaign_id,
    startedAt: row.started_at,
    queries: row.query_count,
    found: row.results_found,
    saved: row.results_saved,
    status: runStatus(row.status),
  }));

  return { campaigns, leads, runs };
}

export async function saveCloudState(
  supabase: SupabaseClient,
  campaigns: Campaign[],
  leads: Lead[]
) {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  const user = userData.user;
  if (!user) throw new Error("Usuário não autenticado.");

  if (campaigns.length) {
    const { error } = await supabase.from("campaigns").upsert(
      campaigns.map((campaign) => ({
        id: campaign.id,
        user_id: user.id,
        name: campaign.name,
        location: campaign.location,
        products: campaign.products,
        intent_phrases: campaign.intentPhrases,
        negative_keywords: campaign.negativeKeywords,
        sources: campaign.sources,
        minimum_score: campaign.minimumScore,
        active: campaign.active,
      })),
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  const existingCampaigns = await supabase.from("campaigns").select("id");
  if (existingCampaigns.error) throw existingCampaigns.error;
  const wantedCampaignIds = new Set(campaigns.map((item) => item.id));
  const removedCampaignIds = (existingCampaigns.data ?? [])
    .map((item) => item.id)
    .filter((id) => !wantedCampaignIds.has(id));
  if (removedCampaignIds.length) {
    const { error } = await supabase.from("campaigns").delete().in("id", removedCampaignIds);
    if (error) throw error;
  }

  if (leads.length) {
    const { error } = await supabase.from("leads").upsert(
      leads.map((lead) => ({
        id: lead.id,
        user_id: user.id,
        campaign_id: lead.campaignId,
        source: lead.source,
        profile_name: lead.profileName,
        profile_url: lead.profileUrl ?? null,
        publication_url: lead.publicationUrl === "#" ? null : lead.publicationUrl,
        publication_text: lead.publicationText,
        published_at: lead.publishedAt,
        score: lead.analysis.score,
        intent: lead.analysis.intent,
        product: lead.analysis.product,
        budget: lead.analysis.budget,
        urgency: lead.analysis.urgency,
        relevance: lead.analysis.relevance,
        recency_weight: lead.analysis.recencyWeight,
        status: lead.status,
        fingerprint: lead.fingerprint,
      })),
      { onConflict: "id" }
    );
    if (error) throw error;
  }

  const existingLeads = await supabase.from("leads").select("id");
  if (existingLeads.error) throw existingLeads.error;
  const wantedLeadIds = new Set(leads.map((item) => item.id));
  const removedLeadIds = (existingLeads.data ?? [])
    .map((item) => item.id)
    .filter((id) => !wantedLeadIds.has(id));
  if (removedLeadIds.length) {
    const { error } = await supabase.from("leads").delete().in("id", removedLeadIds);
    if (error) throw error;
  }

  const currentLeadIds = leads.map((lead) => lead.id);
  if (currentLeadIds.length) {
    const { error: deleteSignalError } = await supabase
      .from("lead_signals")
      .delete()
      .in("lead_id", currentLeadIds);
    if (deleteSignalError) throw deleteSignalError;

    const signals = leads.flatMap((lead) =>
      lead.analysis.signals.map((signal) => ({
        lead_id: lead.id,
        signal,
        weight: null,
        reason: null,
      }))
    );

    if (signals.length) {
      const { error } = await supabase.from("lead_signals").insert(signals);
      if (error) throw error;
    }
  }
}
