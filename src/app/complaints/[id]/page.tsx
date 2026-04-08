"use client";

import useSWR from "swr";
import { useParams } from "next/navigation";
import { Button } from "@/components/Button";
import { MapPicker } from "@/components/MapPicker";
import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/Card";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ComplaintEventDto = { id: string; createdAt: string; message: string };
type CompanyResponseDto = {
  id: string;
  createdAt: string;
  authorName: string | null;
  message: string;
};
type AttachmentDto = {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
};
type ComplaintDetailDto = {
  id: string;
  createdAt: string;
  status: string;
  issue: string;
  description: string;
  locationLabel: string | null;
  locationLat: number | null;
  locationLng: number | null;
  company: { name: string };
  events: ComplaintEventDto[];
  responses: CompanyResponseDto[];
  attachments: AttachmentDto[];
  proofRequired: boolean;
};

export default function ComplaintDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading, mutate } = useSWR<ComplaintDetailDto>(
    `/api/complaints/${id}`,
    fetcher,
  );
  const [contestMsg, setContestMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [attachmentsToUpload, setAttachmentsToUpload] = useState<File[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [attachmentsUploadError, setAttachmentsUploadError] = useState<string | null>(null);
  const [attachmentsInputKey, setAttachmentsInputKey] = useState(0);

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (error) return <div className="p-6">Erro ao carregar</div>;
  if (!data) return <div className="p-6">Não encontrado</div>;

  const shortId = data.id.slice(-6).toUpperCase();
  const statusLabel: Record<string, string> = {
    REGISTERED: "Aberta",
    NEEDS_REVIEW: "Em análise",
    PUBLISHED: "Publicada",
    COMPANY_REPLIED: "Respondida",
    USER_CONTESTED: "Contestada",
    RESOLVED: "Resolvida",
    CLOSED: "Encerrada",
  };

  async function markResolved() {
    setSending(true);
    await fetch(`/api/complaints/${id}/resolve`, { method: "POST" });
    await mutate();
    setSending(false);
  }

  async function contest() {
    if (!contestMsg || contestMsg.trim().length < 5) return;
    setSending(true);
    await fetch(`/api/complaints/${id}/contest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: contestMsg }),
    });
    await mutate();
    setContestMsg("");
    setSending(false);
  }

  async function removeComplaint() {
    const shortId = id.slice(-6).toUpperCase();
    const typed = window.prompt(
      `Para confirmar a remoção, digite ${shortId}`,
      "",
    );
    if (!typed) return;

    setSending(true);
    try {
      const res = await fetch(`/api/complaints/${id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        alert(out?.error ?? "Falha ao remover.");
        return;
      }
      await mutate();
    } finally {
      setSending(false);
    }
  }

  async function uploadProof() {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/complaints/${id}/attachments`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setUploadError(data?.error ?? "Falha ao enviar arquivo.");
        return;
      }
      setFile(null);
      await mutate();
    } finally {
      setUploading(false);
    }
  }

  async function uploadAttachments() {
    if (attachmentsToUpload.length === 0) return;
    setAttachmentsUploading(true);
    setAttachmentsUploadError(null);
    try {
      for (const file of attachmentsToUpload) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/complaints/${id}/attachments`, { method: "POST", body: form });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setAttachmentsUploadError(data?.error ?? "Falha ao enviar anexos.");
          return;
        }
      }
      setAttachmentsToUpload([]);
      setAttachmentsInputKey((k) => k + 1);
      await mutate();
    } finally {
      setAttachmentsUploading(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background px-6 py-8">
      <div className="w-full max-w-3xl mx-auto">
        <header className="flex items-center justify-between gap-4">
          <Link href="/complaints" className="text-sm text-primary hover:text-highlight">
            &lt; Voltar
          </Link>
          <div className="text-right">
            <div className="font-title font-bold text-lg">Reclamação #{shortId}</div>
            <div className="text-xs text-foreground/60">
              {new Date(data.createdAt).toLocaleDateString("pt-BR")}
            </div>
          </div>
        </header>

        <Card className="mt-6 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="font-title font-bold text-xl">{data.issue}</div>
              <div className="text-sm text-foreground/70 mt-1">{data.company.name}</div>
              {data.locationLabel ? (
                <div className="text-xs text-foreground/60 mt-2">{data.locationLabel}</div>
              ) : null}
            </div>
            <div className="inline-flex items-center rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-title font-semibold">
              Status atual: {statusLabel[data.status] ?? data.status}
            </div>
          </div>
        </Card>

        <section className="mt-6 space-y-3">
          <h2 className="font-title font-bold text-lg">Linha do tempo</h2>
          <div className="grid gap-2">
            {data.events.map((ev) => (
              <div
                key={ev.id}
                className="rounded-2xl bg-white border border-black/10 px-4 py-3 text-sm"
              >
                <div className="text-foreground/70">
                  {new Date(ev.createdAt).toLocaleString("pt-BR")}
                </div>
                <div className="mt-1">{ev.message}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="font-title font-bold text-lg">Descrição</h2>
          <Card className="p-6">
            <div className="text-sm text-foreground/80 leading-6">{data.description}</div>
            {data.locationLat && data.locationLng ? (
              <div className="mt-4">
                <MapPicker lat={data.locationLat} lng={data.locationLng} height={260} readOnly />
              </div>
            ) : null}
          </Card>
        </section>

        {data.status === "NEEDS_REVIEW" && data.proofRequired ? (
          <section className="mt-6 space-y-3">
            <h2 className="font-title font-bold text-lg">Enviar comprovação</h2>
            <Card className="p-6 space-y-3">
              <div className="text-sm text-foreground/70">
                Sua reclamação está oculta até que você envie uma comprovação.
              </div>
              <input
                type="file"
                aria-label="Selecionar arquivo de comprovação"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {uploadError ? (
                <div
                  className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
                  role="alert"
                  aria-live="assertive"
                >
                  {uploadError}
                </div>
              ) : null}
              <Button disabled={!file || uploading} onClick={uploadProof}>
                {uploading ? "Enviando..." : "Enviar arquivo"}
              </Button>
            </Card>
          </section>
        ) : null}

        <section className="mt-6 space-y-3">
          <h2 className="font-title font-bold text-lg">Anexos</h2>
          {data.status !== "CLOSED" ? (
            <Card className="p-6 space-y-3">
              <div className="text-sm text-foreground/70">
                Envie fotos (JPG/PNG/WEBP) ou vídeos (MP4). Limite de 5 arquivos, 5MB cada.
              </div>
              <input
                key={attachmentsInputKey}
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
                  setAttachmentsToUpload(truncated);
                  if (list.length > maxCount) {
                    setAttachmentsUploadError("Limite de 5 anexos.");
                    return;
                  }
                  const rejectedType = list.some((f) => !allowed.has(f.type));
                  if (rejectedType) {
                    setAttachmentsUploadError("Alguns arquivos foram ignorados por tipo não permitido.");
                    return;
                  }
                  const rejectedSize = list.some((f) => f.size > maxBytes);
                  if (rejectedSize) {
                    setAttachmentsUploadError("Alguns arquivos foram ignorados por excederem 5MB.");
                    return;
                  }
                  setAttachmentsUploadError(null);
                }}
              />
              {attachmentsToUpload.length ? (
                <ul className="text-sm text-foreground/80 list-disc pl-5">
                  {attachmentsToUpload.map((f) => (
                    <li key={`${f.name}:${f.size}:${f.type}`}>{f.name}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-foreground/70">Nenhum arquivo selecionado.</div>
              )}
              {attachmentsUploadError ? (
                <div
                  className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
                  role="alert"
                  aria-live="assertive"
                >
                  {attachmentsUploadError}
                </div>
              ) : null}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  disabled={attachmentsUploading || attachmentsToUpload.length === 0}
                  onClick={uploadAttachments}
                  className="flex-1"
                >
                  {attachmentsUploading ? "Enviando..." : "Enviar anexos"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={attachmentsUploading || attachmentsToUpload.length === 0}
                  onClick={() => {
                    setAttachmentsToUpload([]);
                    setAttachmentsUploadError(null);
                    setAttachmentsInputKey((k) => k + 1);
                  }}
                  className="flex-1"
                >
                  Limpar
                </Button>
              </div>
            </Card>
          ) : null}
          {data.attachments.length ? (
            <div className="grid gap-2">
              {data.attachments.map((a) => (
                <Card key={a.id} className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:text-highlight"
                      >
                        {a.filename}
                      </a>
                      <div className="text-xs text-foreground/60 mt-1">{a.mimeType}</div>
                    </div>
                    <div className="text-right text-xs text-foreground/60">
                      <div>{Math.round(a.size / 1024)} KB</div>
                      <div>{new Date(a.createdAt).toLocaleString("pt-BR")}</div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-6">
              <div className="text-sm text-foreground/70">Nenhum anexo.</div>
            </Card>
          )}
        </section>

        <section className="mt-6 space-y-3">
          <h2 className="font-title font-bold text-lg">Resposta da empresa</h2>
          {data.responses.length ? (
            <div className="grid gap-2">
              {data.responses.map((r) => (
                <Card key={r.id} className="p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm text-foreground/70">{data.company.name}</div>
                    <div className="text-xs text-foreground/60">
                      {new Date(r.createdAt).toLocaleString("pt-BR")}
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-foreground/80 leading-6">
                    {r.message}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-6">
              <div className="text-sm text-foreground/70">Ainda não há resposta da empresa.</div>
            </Card>
          )}
        </section>

        <section className="mt-6 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              disabled={sending || data.status === "RESOLVED"}
              onClick={markResolved}
              className="flex-1"
            >
              Marcar como resolvida
            </Button>
            <Button
              disabled={sending || !contestMsg || contestMsg.trim().length < 5}
              variant="secondary"
              onClick={contest}
              className="flex-1"
            >
              Contestar resposta
            </Button>
          </div>
          <Button
            disabled={sending || data.status === "CLOSED"}
            variant="secondary"
            onClick={removeComplaint}
            className="w-full"
          >
            Remover reclamação
          </Button>
          <textarea
            className="w-full min-h-24 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
            placeholder="Explique o motivo da contestação"
            value={contestMsg}
            onChange={(e) => setContestMsg(e.target.value)}
          />
        </section>
      </div>
    </div>
  );
}
