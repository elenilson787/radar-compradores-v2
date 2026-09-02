"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import App from "./App";
import { loadCloudState, saveCloudState } from "@/lib/cloud";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { Campaign, Lead } from "@/lib/types";

const STORE = "radar-compradores-v2-state";

type StoredState = {
  campaigns: Campaign[];
  leads: Lead[];
};

function parseStored(raw: string | null): StoredState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value.campaigns) || !Array.isArray(value.leads)) return null;
    return value as StoredState;
  } catch {
    return null;
  }
}

export default function CloudGate() {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [dataReady, setDataReady] = useState(!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncError, setSyncError] = useState("");
  const lastStored = useRef<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (!supabase) return;

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
      if (!nextSession) setDataReady(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session) return;

    let cancelled = false;
    setDataReady(false);
    setSyncError("");

    (async () => {
      try {
        const cloud = await loadCloudState(supabase);
        if (cancelled) return;

        const raw = JSON.stringify({ campaigns: cloud.campaigns, leads: cloud.leads });
        localStorage.setItem(STORE, raw);
        lastStored.current = raw;
        setDataReady(true);
      } catch (error) {
        if (cancelled) return;
        setSyncError(error instanceof Error ? error.message : "Falha ao carregar o Supabase.");
        setDataReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase, session]);

  useEffect(() => {
    if (!supabase || !session || !dataReady) return;

    const timer = window.setInterval(async () => {
      if (saving.current) return;
      const raw = localStorage.getItem(STORE);
      if (!raw || raw === lastStored.current) return;
      const parsed = parseStored(raw);
      if (!parsed) return;

      saving.current = true;
      try {
        await saveCloudState(supabase, parsed.campaigns, parsed.leads);
        lastStored.current = raw;
        setSyncError("");
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Falha ao salvar no Supabase.");
      } finally {
        saving.current = false;
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [supabase, session, dataReady]);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !email || !password) return;
    setBusy(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setMessage(error.message);
  }

  async function signUp() {
    if (!supabase || !email || password.length < 6) {
      setMessage("Informe um e-mail e uma senha com pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.auth.signUp({ email, password });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    if (!data.session) setMessage("Conta criada. Confirme o e-mail enviado pelo Supabase e depois entre.");
  }

  if (!supabase) {
    return <>
      <App />
      <div className="cloud-chip local">Modo local · Supabase ainda não configurado</div>
    </>;
  }

  if (!authReady) {
    return <div className="auth-shell"><div className="auth-card"><h1>Radar de Compradores V2</h1><p>Verificando sua sessão...</p></div></div>;
  }

  if (!session) {
    return <div className="auth-shell">
      <form className="auth-card" onSubmit={signIn}>
        <div className="auth-mark">◎</div>
        <span className="auth-eyebrow">ACESSO PESSOAL</span>
        <h1>Radar de Compradores V2</h1>
        <p>Entre para manter campanhas e oportunidades protegidas pelo RLS do Supabase.</p>
        <label>E-mail<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
        <label>Senha<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
        {message && <div className="auth-message">{message}</div>}
        <button className="btn primary auth-button" disabled={busy} type="submit">{busy ? "Aguarde..." : "Entrar"}</button>
        <button className="btn subtle auth-button" disabled={busy} type="button" onClick={signUp}>Criar minha conta</button>
        <small>A chave usada no navegador é pública. A service role não é necessária.</small>
      </form>
    </div>;
  }

  if (!dataReady) {
    return <div className="auth-shell"><div className="auth-card"><h1>Radar de Compradores V2</h1><p>Carregando seus dados do Supabase...</p></div></div>;
  }

  return <>
    <App />
    <div className={`cloud-chip ${syncError ? "error" : ""}`}>
      <span>{syncError ? `Supabase: ${syncError}` : `Supabase conectado · ${session.user.email ?? "usuário"}`}</span>
      <button onClick={() => supabase.auth.signOut()}>Sair</button>
    </div>
  </>;
}
