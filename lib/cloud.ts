import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeText } from "./scoring";
import { applyAttributionGuard } from "./source-quality";
import { createFingerprint } from "./dedupe";
import type { Campaign, Lead, LeadStatus, SearchRun, Source } from "./types";

type CloudState = {
  campaigns: Campaign[];
  leads: Lead[];
  runs: SearchRun[];
};

function runStatus(value: string): SearchRun["status"] {
  if (value === "running") return "Executando";
  if (value === "failed") return "Falhou";
  return "Concluída";
}

function preferLead(current: Lead, candidate: Lead) {
  if (current.source === "Web" && candidate.source !== "Web") return candidate;
  if (candidate.source === "Web" && current.source !== "Web") return current;
  if (candidate.analysis.score > current.analysis.score) return candidate;
  if (candidate.analysis.score < current.analysis.score) return current;
  return new Date(candidate.createdAt).getTime() > new Date(current.createdAt).getTime() ? candidate : current;
}

export async function loadCloudState(supabase: SupabaseClient): Promise<CloudState> {
  const [campaignsResult, leadsResult, runsResult] = await Promise.all([
    supabase.from("campaigns").select("*").order("created_at", { ascending: true }),
    supabase.from("leads").select("*").order("created_at", { ascending: false }),
    supabase.from("search_runs").select("*").order("started_at", { ascending: false }).limit(100),
  ]);

  for (const result of [campaignsResult, leadsResult, runsResult]) {
    if (result.error) throw result.error;
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

  const campaignMap = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const mappedLeads: Lead[] = (leadsResult.data ?? []).map((row) => {
    const campaign = campaignMap.get(row.campaign_id);
    const publishedAt = row.published_at || row.created_at;
    const profileName = row.profile_name || "Perfil público";
    const publicationUrl = row.publication_url || "#";
    const publicationText = row.publication_text;
    const rawAnalysis = analyzeText(publicationText, campaign, publishedAt, profileName);
    const analysis = applyAttributionGuard(rawAnalysis, profileName, publicationText);
    const fingerprint = createFingerprint(row.source as Source, publicationUrl, publicationText);

    return {
      id: row.id,
      campaignId: row.campaign_id,
      source: row.source as Source,
      profileName,
      profileUrl: row.profile_url || undefined,
      publicationUrl,
      publicationText,
      publishedAt,
      createdAt: row.created_at,
      status: row.status as LeadStatus,
      analysis,
      fingerprint,
    };
  });

  const leadMap = new Map<string, Lead>();
  for (const lead of mappedLeads) {
    const existing = leadMap.get(lead.fingerprint);
    leadMap.set(lead.fingerprint, existing ? preferLead(existing, lead) : lead);
  }
  const leads = [...leadMap.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
