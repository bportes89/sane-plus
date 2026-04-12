"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { MapPicker } from "@/components/MapPicker";
import { categories } from "@/lib/categories";
import { useRouter } from "next/navigation";

type Step = 1 | 2 | 3;

export default function NewComplaintPage() {
  const [step, setStep] = useState<Step>(1);
  const router = useRouter();
  const saveTimerRef = useRef<number | null>(null);
  const cepTimerRef = useRef<number | null>(null);
  const cepAbortRef = useRef<AbortController | null>(null);

  const [companyName, setCompanyName] = useState("");
  const [category, setCategory] = useState<keyof typeof categories>("Água");
  const [subcategory, setSubcategory] = useState(categories["Água"][0]);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(
    null,
  );
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [cepText, setCepText] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cepStatus, setCepStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [cepError, setCepError] = useState<string | null>(null);
  const [detectedCity, setDetectedCity] = useState("");
  const [detectedState, setDetectedState] = useState("");
  const [detectedLabel, setDetectedLabel] = useState("");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [moderation, setModeration] = useState<{
    severity?: string;
    flags?: {
      pii?: boolean;
      profanity?: boolean;
      employeeName?: boolean;
      crimeAccusation?: boolean;
      hatefulOrSexual?: boolean;
      sensitiveData?: boolean;
      manualReview?: boolean;
    };
  } | null>(null);

  const locationLabel = [neighborhood, street, number ? `nº ${number}` : ""]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(", ");

  useEffect(() => {
    try {
      const rawV2 = localStorage.getItem("saneplus.complaintDraft.v2");
      const rawV1 = localStorage.getItem("saneplus.complaintDraft.v1");
      const raw = rawV2 ?? rawV1;
      if (!raw) return;
      const draft = JSON.parse(raw) as {
        step?: number;
        companyName?: string;
        category?: keyof typeof categories;
        subcategory?: string;
        position?: { lat: number; lng: number } | null;
        cepText?: string;
        neighborhood?: string;
        street?: string;
        number?: string;
        description?: string;
      };
      const nextStep = Number(draft.step);
      if (nextStep >= 1 && nextStep <= 3) setStep(nextStep as Step);
      if (typeof draft.companyName === "string") setCompanyName(draft.companyName);
      if (draft.category && draft.category in categories) {
        setCategory(draft.category);
        const list = categories[draft.category];
        const picked = typeof draft.subcategory === "string" ? draft.subcategory : "";
        setSubcategory(list.includes(picked) ? picked : list[0]);
      }
      if (draft.position && typeof draft.position.lat === "number" && typeof draft.position.lng === "number") {
        setPosition({ lat: draft.position.lat, lng: draft.position.lng });
        setLatText(String(draft.position.lat));
        setLngText(String(draft.position.lng));
      }
      if (typeof draft.cepText === "string") setCepText(draft.cepText);
      if (typeof draft.neighborhood === "string") setNeighborhood(draft.neighborhood);
      if (typeof draft.street === "string") setStreet(draft.street);
      if (typeof draft.number === "string") setNumber(draft.number);
      if (typeof draft.description === "string") setDescription(draft.description);
    } catch {}
  }, []);

  useEffect(() => {
    const digits = cepText.replace(/\D/g, "");
    setCepError(null);
    if (digits.length !== 8) {
      setCepStatus("idle");
      setDetectedCity("");
      setDetectedState("");
      setDetectedLabel("");
      if (cepTimerRef.current) window.clearTimeout(cepTimerRef.current);
      cepAbortRef.current?.abort();
      cepAbortRef.current = null;
      return;
    }

    if (cepTimerRef.current) window.clearTimeout(cepTimerRef.current);
    cepTimerRef.current = window.setTimeout(() => {
      cepAbortRef.current?.abort();
      const controller = new AbortController();
      cepAbortRef.current = controller;
      setCepStatus("loading");
      void (async () => {
        try {
          const res = await fetch(`/api/geo/cep?cep=${digits}`, { signal: controller.signal });
          const json = (await res.json().catch(() => null)) as unknown;
          if (!res.ok) {
            setCepStatus("error");
            setCepError("Não foi possível encontrar esse CEP.");
            setDetectedCity("");
            setDetectedState("");
            setDetectedLabel("");
            return;
          }
          const obj =
            json && typeof json === "object"
              ? (json as Record<string, unknown>)
              : ({} as Record<string, unknown>);
          if (typeof obj.neighborhood === "string") setNeighborhood(obj.neighborhood);
          if (typeof obj.street === "string") setStreet(obj.street);
          setDetectedCity(typeof obj.city === "string" ? obj.city : "");
          setDetectedState(typeof obj.state === "string" ? obj.state : "");
          setDetectedLabel(typeof obj.label === "string" ? obj.label : "");
          if (typeof obj.lat === "number" && typeof obj.lng === "number") {
            setPosition({ lat: obj.lat, lng: obj.lng });
            setLatText(String(obj.lat));
            setLngText(String(obj.lng));
          }
          setCepStatus("ok");
        } catch (e) {
          if ((e as { name?: string } | null)?.name === "AbortError") return;
          setCepStatus("error");
          setCepError("Falha ao buscar CEP. Tente novamente.");
          setDetectedCity("");
          setDetectedState("");
          setDetectedLabel("");
        }
      })();
    }, 350);

    return () => {
      if (cepTimerRef.current) window.clearTimeout(cepTimerRef.current);
    };
  }, [cepText]);

  useEffect(() => {
    const v = (s: string) => {
      if (!s.trim()) return null;
      const n = Number(s.replace(",", "."));
      return Number.isFinite(n) ? n : null;
    };
    const lat = v(latText);
    const lng = v(lngText);
    if (lat === null || lng === null) return;
    setPosition({ lat, lng });
  }, [latText, lngText]);

  useEffect(() => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          "saneplus.complaintDraft.v2",
          JSON.stringify({
            step,
            companyName,
            category,
            subcategory,
            position,
            cepText,
            neighborhood,
            street,
            number,
            description,
          }),
        );
      } catch {}
    }, 350);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [
    step,
    companyName,
    category,
    subcategory,
    position,
    cepText,
    neighborhood,
    street,
    number,
    description,
  ]);

  const moderationIssues = (() => {
    const f = moderation?.flags;
    if (!f) return [];
    const items: string[] = [];
    if (f.pii) items.push("Dados pessoais / endereço completo");
    if (f.employeeName) items.push("Nome de funcionário/pessoa");
    if (f.profanity) items.push("Ofensa/palavrão");
    if (f.crimeAccusation) items.push("Possível acusação criminal sem prova");
    if (f.sensitiveData) items.push("Dado sensível (ex.: saúde, religião, orientação)");
    if (f.hatefulOrSexual) items.push("Conteúdo sexual/discriminatório");
    if (f.manualReview) items.push("Tema sensível (precisa revisão humana)");
    return items;
  })();

  async function submit() {
    setSending(true);
    setError(null);
    setAttachmentsError(null);
    setModeration(null);
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName,
          category,
          subcategory,
          issue: subcategory,
          description,
          neighborhood,
          street,
          number,
          locationLat: position?.lat,
          locationLng: position?.lng,
          locationLabel,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | {
              error?: string;
              moderation?: {
                severity?: string;
                flags?: {
                  pii?: boolean;
                  profanity?: boolean;
                  employeeName?: boolean;
                  crimeAccusation?: boolean;
                  hatefulOrSexual?: boolean;
                  sensitiveData?: boolean;
                  manualReview?: boolean;
                };
              };
            }
          | null;
        setError(data?.error ?? "Falha ao enviar.");
        if (data?.moderation) {
          setModeration({
            severity: data.moderation.severity,
            flags: data.moderation.flags ?? undefined,
          });
          if (data.moderation.severity === "block") {
            setStep(3);
          }
        }
        return;
      }
      const { id } = (await res.json()) as { id: string };
      let uploadFailed = false;
      for (const file of attachments) {
        const form = new FormData();
        form.append("file", file);
        const up = await fetch(`/api/complaints/${id}/attachments`, {
          method: "POST",
          body: form,
        });
        if (!up.ok) {
          uploadFailed = true;
          const data = (await up.json().catch(() => null)) as { error?: string } | null;
          setAttachmentsError(data?.error ?? "Falha ao enviar um ou mais anexos.");
          break;
        }
      }
      try {
        localStorage.removeItem("saneplus.complaintDraft.v2");
      } catch {}
      if (uploadFailed) {
        setCreatedId(id);
        return;
      }
      router.replace(`/complaints/${id}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-dvh px-6 py-8">
      <div className="w-full max-w-2xl mx-auto">
        <h1 className="font-title font-bold text-2xl">Registrar Reclamação</h1>
        <p className="text-foreground/70" aria-live="polite">
          Passo {step} de 3
        </p>

        <Card className="mt-6 p-6">
          {step === 1 ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <label htmlFor="companyName" className="block text-sm font-medium">
                  Qual empresa você quer reclamar?
                </label>
                <Input
                  id="companyName"
                  placeholder="Nome da empresa"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                />
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium">Qual é o problema?</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(categories) as Array<keyof typeof categories>).map(
                    (c) => (
                      <Button
                        key={c}
                        variant={c === category ? "primary" : "secondary"}
                        aria-pressed={c === category}
                        onClick={() => {
                          setCategory(c);
                          setSubcategory(categories[c][0]);
                        }}
                      >
                        {c}
                      </Button>
                    ),
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {categories[category].map((s) => (
                    <Button
                      key={s}
                      variant={s === subcategory ? "primary" : "secondary"}
                      aria-pressed={s === subcategory}
                      onClick={() => setSubcategory(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Onde aconteceu?</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1 sm:col-span-2">
                  <label htmlFor="cep" className="block text-sm font-medium">
                    CEP (opcional)
                  </label>
                  <Input
                    id="cep"
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="00000-000"
                    value={cepText}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
                      const formatted = digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
                      setCepText(formatted);
                    }}
                    aria-describedby="cep-hint"
                  />
                  <div id="cep-hint" className="text-xs text-foreground/70">
                    {cepStatus === "loading"
                      ? "Buscando endereço…"
                      : cepError
                        ? cepError
                        : "Ao digitar o CEP, preenche rua e localização automaticamente."}
                  </div>
                </div>
                <div className="space-y-1">
                  <label htmlFor="neighborhood" className="block text-sm font-medium">
                    Bairro
                  </label>
                  <Input
                    id="neighborhood"
                    value={neighborhood}
                    onChange={(e) => setNeighborhood(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="street" className="block text-sm font-medium">
                    Rua (opcional)
                  </label>
                  <Input
                    id="street"
                    value={street}
                    onChange={(e) => setStreet(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="number" className="block text-sm font-medium">
                    Número (opcional)
                  </label>
                  <Input
                    id="number"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="lat" className="block text-sm font-medium">
                    Latitude (opcional)
                  </label>
                  <Input
                    id="lat"
                    inputMode="decimal"
                    placeholder="-23.55"
                    value={latText}
                    onChange={(e) => setLatText(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="lng" className="block text-sm font-medium">
                    Longitude (opcional)
                  </label>
                  <Input
                    id="lng"
                    inputMode="decimal"
                    placeholder="-46.63"
                    value={lngText}
                    onChange={(e) => setLngText(e.target.value)}
                  />
                </div>
              </div>
              <div className="text-xs text-foreground/70">
                Evite incluir dados pessoais de terceiros.
              </div>
              <MapPicker
                label="Mapa para selecionar localização (opcional)"
                describedBy="map-help"
                lat={position?.lat}
                lng={position?.lng}
                onChange={(p) => {
                  setPosition(p);
                  setLatText(String(p.lat));
                  setLngText(String(p.lng));
                }}
              />
              {detectedCity || detectedState || detectedLabel ? (
                <div className="rounded-2xl border border-[#E7D7FF] bg-[linear-gradient(135deg,rgba(130,10,209,0.08)_0%,rgba(179,136,255,0.10)_100%)] px-4 py-3 text-sm text-[#45207A]">
                  <div className="font-title text-[11px] font-semibold uppercase tracking-[0.14em] text-[#820AD1]">
                    Local detectado pelo CEP
                  </div>
                  <div className="mt-1 text-base font-semibold text-foreground">
                    {[detectedCity, detectedState].filter(Boolean).join(" / ") || "Local identificado"}
                  </div>
                  {detectedLabel ? <div className="mt-1 text-sm text-foreground/75">{detectedLabel}</div> : null}
                </div>
              ) : null}
              <div id="map-help" className="text-xs text-foreground/70">
                Você pode marcar no mapa ou digitar latitude/longitude.
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-6">
              <div className="space-y-3">
              <label htmlFor="description" className="block text-sm font-medium">
                Descreva o problema
              </label>
              <textarea
                id="description"
                className="w-full min-h-32 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
                placeholder="Conte o que aconteceu. Evite nomes de funcionários e acusações sem prova."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                aria-describedby="desc-hint"
              />
              <div id="desc-hint" className="text-xs text-foreground/70">
                Exemplo: “Estou sem água desde ontem no meu bairro. Já abri protocolo e não tive retorno.”
              </div>
              {error ? (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
                >
                  <div>{error}</div>
                  {moderationIssues.length ? (
                    <ul className="mt-2 list-disc pl-5">
                      {moderationIssues.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
              </div>

              <div className="space-y-2">
                <div className="font-title font-semibold text-lg">Revise</div>
                <ul className="text-sm text-foreground/80">
                  <li>Empresa: {companyName || "—"}</li>
                  <li>
                    Categoria: {category} / {subcategory}
                  </li>
                  <li>Local: {locationLabel || neighborhood || "—"}</li>
                </ul>
              </div>

              <div className="space-y-2">
                <div className="font-title font-semibold text-lg">Anexos (opcional)</div>
                <div className="text-sm text-foreground/70">
                  Você pode enviar até 5 arquivos (fotos e vídeos MP4) com até 5MB cada.
                </div>
                <input
                  key={fileInputKey}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,video/mp4"
                  aria-label="Selecionar anexos"
                  onChange={(e) => {
                    const list = Array.from(e.target.files ?? []);
                    const allowed = new Set([
                      "image/jpeg",
                      "image/png",
                      "image/webp",
                      "video/mp4",
                    ]);
                    const maxCount = 5;
                    const maxBytes = 5 * 1024 * 1024;
                    const picked = list.filter((f) => allowed.has(f.type) && f.size > 0 && f.size <= maxBytes);
                    const truncated = picked.slice(0, maxCount);
                    setAttachments(truncated);
                    if (list.length > maxCount) {
                      setAttachmentsError("Limite de 5 anexos.");
                      return;
                    }
                    const rejectedType = list.some((f) => !allowed.has(f.type));
                    if (rejectedType) {
                      setAttachmentsError("Alguns arquivos foram ignorados por tipo não permitido.");
                      return;
                    }
                    const rejectedSize = list.some((f) => f.size > maxBytes);
                    if (rejectedSize) {
                      setAttachmentsError("Alguns arquivos foram ignorados por excederem 5MB.");
                      return;
                    }
                    setAttachmentsError(null);
                  }}
                />
                {attachments.length ? (
                  <ul className="text-sm text-foreground/80 list-disc pl-5">
                    {attachments.map((f) => (
                      <li key={`${f.name}:${f.size}:${f.type}`}>{f.name}</li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-foreground/70">Nenhum arquivo selecionado.</div>
                )}
                {attachmentsError ? (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
                  >
                    {attachmentsError}
                  </div>
                ) : null}
                <Button disabled={sending || createdId !== null || description.trim().length < 10} onClick={submit}>
                  {sending ? "Enviando..." : "Enviar Reclamação"}
                </Button>
                {createdId ? (
                  <Button variant="secondary" disabled={sending} onClick={() => router.replace(`/complaints/${createdId}`)}>
                    Abrir reclamação
                  </Button>
                ) : null}
                {attachments.length ? (
                  <Button
                    variant="secondary"
                    disabled={sending}
                    onClick={() => {
                      setAttachments([]);
                      setAttachmentsError(null);
                      setFileInputKey((k) => k + 1);
                    }}
                  >
                    Limpar anexos
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </Card>

        <div className="mt-4 flex gap-3">
          <Button
            variant="secondary"
            onClick={() => setStep((s) => Math.max(1, s - 1) as Step)}
            disabled={step === 1}
          >
            Voltar
          </Button>
          <Button
            onClick={() => setStep((s) => Math.min(3, s + 1) as Step)}
            disabled={
              (step === 1 && !companyName.trim()) ||
              (step === 2 && !neighborhood.trim()) ||
              (step === 3 && description.trim().length < 10)
            }
          >
            Avançar
          </Button>
        </div>
      </div>
    </div>
  );
}
