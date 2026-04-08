"use client";

import { useState } from "react";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";

export function CompanySettingsForm(props: {
  companyId: string;
  initial: { name?: string | null; city?: string | null; state?: string | null; logoUrl?: string | null };
}) {
  const [name, setName] = useState(props.initial.name ?? "");
  const [city, setCity] = useState(props.initial.city ?? "");
  const [state, setState] = useState((props.initial.state ?? "").toUpperCase());
  const [logoUrl, setLogoUrl] = useState(props.initial.logoUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setOk(null);
    setError(null);
    try {
      const res = await fetch(`/api/companies/${props.companyId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name?.trim() || undefined,
          city: city?.trim() || undefined,
          state: state?.trim().toUpperCase() || undefined,
          logoUrl: logoUrl?.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "Falha ao salvar.");
        return;
      }
      setOk("Configurações salvas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Nome da empresa</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Saneamento Alfa S.A." />
        </label>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Logo (URL)</div>
          <Input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
        </label>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Cidade</div>
          <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ex.: Belo Horizonte" />
        </label>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">UF</div>
          <Input
            value={state}
            onChange={(e) => setState(e.target.value.toUpperCase().slice(0, 2))}
            placeholder="Ex.: MG"
          />
        </label>
      </div>
      {error ? <div className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]">{error}</div> : null}
      {ok ? <div className="rounded-xl bg-[#ecfff2] px-4 py-3 text-sm text-[#0d6b2f]">{ok}</div> : null}
      <Button onClick={onSave} disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</Button>
      <div className="text-xs text-foreground/60">Evite dados pessoais em nomes/imagens. Cumprimento LGPD.</div>
    </div>
  );
}

