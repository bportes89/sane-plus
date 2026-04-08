"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";

type Flags = {
  pii?: boolean;
  profanity?: boolean;
  employeeName?: boolean;
  crimeAccusation?: boolean;
  hatefulOrSexual?: boolean;
  sensitiveData?: boolean;
  manualReview?: boolean;
};

function flagsToItems(flags?: Flags) {
  if (!flags) return [];
  const items: string[] = [];
  if (flags.pii) items.push("Dados pessoais / endereço completo");
  if (flags.employeeName) items.push("Nome de funcionário/pessoa");
  if (flags.profanity) items.push("Ofensa/palavrão");
  if (flags.crimeAccusation) items.push("Possível acusação criminal sem prova");
  if (flags.sensitiveData) items.push("Dado sensível");
  if (flags.hatefulOrSexual) items.push("Conteúdo sexual/discriminatório");
  if (flags.manualReview) items.push("Tema sensível (revisão humana)");
  return items;
}

export function CompanyActions(props: { complaintId: string }) {
  const [authorName, setAuthorName] = useState("");
  const [reply, setReply] = useState("");
  const [lastResponseId, setLastResponseId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [contestReason, setContestReason] = useState("");
  const [contestMessage, setContestMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [replyOk, setReplyOk] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [replyFlags, setReplyFlags] = useState<Flags | null>(null);
  const [contestOk, setContestOk] = useState<string | null>(null);
  const [contestError, setContestError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("STRUCTURE");

  const issues = useMemo(() => flagsToItems(replyFlags ?? undefined), [replyFlags]);
  const templates = useMemo(
    () => [
      {
        id: "STRUCTURE",
        label: "Estrutura padrão",
        message:
          "Olá, obrigado por informar.\n\n1) O que identificamos: [DESCREVA O PROBLEMA / CONTEXTO]\n2) Ação tomada: [O QUE FOI FEITO OU SERÁ FEITO]\n3) Prazo estimado: [PRAZO]\n4) Próximos passos: [O QUE O USUÁRIO DEVE ACOMPANHAR]\n\nSeguimos à disposição.",
      },
      {
        id: "ACK_AND_ANALYZE",
        label: "Acolher + analisar",
        message:
          "Olá, sentimos pelo transtorno e agradecemos seu contato.\n\nJá registramos sua solicitação e estamos analisando o caso. Assim que tivermos uma atualização (incluindo prazos), retornaremos por aqui.\n\nSeguimos à disposição.",
      },
      {
        id: "ASK_MORE_INFO",
        label: "Pedir mais dados",
        message:
          "Olá, obrigado por informar.\n\nPara te ajudar melhor, precisamos de algumas informações:\n- Bairro/rua (sem número da residência)\n- Dia e horário aproximado do ocorrido\n- Se possível, uma foto/vídeo do problema (evite dados pessoais)\n\nCom isso, conseguimos direcionar a equipe adequada. Seguimos à disposição.",
      },
      {
        id: "SCHEDULE_VISIT",
        label: "Agendar vistoria",
        message:
          "Olá, obrigado por informar.\n\nPodemos agendar uma vistoria técnica para verificar a situação. Por favor, informe:\n- Melhor período (manhã/tarde)\n- Um contato para retorno (sem compartilhar dados de terceiros)\n\nAssim que confirmarmos o agendamento, retornaremos com o dia e horário. Seguimos à disposição.",
      },
      {
        id: "BILL_REVIEW",
        label: "Revisão de conta",
        message:
          "Olá, entendemos sua preocupação e obrigado por informar.\n\nVamos abrir uma análise de faturamento para verificar o motivo da variação. Caso seja necessário, orientaremos os próximos passos (ex.: revisão de leitura ou vistoria do hidrômetro).\n\nRetornaremos com uma atualização em até [PRAZO].",
      },
      {
        id: "SERVICE_RESTORED",
        label: "Serviço normalizado",
        message:
          "Olá, obrigado por informar.\n\nRegistramos a ocorrência e o serviço foi normalizado em [DATA/HORA]. Se o problema persistir, avise por aqui para reabrirmos a verificação.\n\nSeguimos à disposição.",
      },
    ],
    [],
  );

  async function sendReply() {
    setSending(true);
    setReplyOk(null);
    setReplyError(null);
    setReplyFlags(null);
    try {
      const res = await fetch(`/api/complaints/${props.complaintId}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authorName, message: reply }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; moderation?: { flags?: Flags } }
          | null;
        setReplyError(data?.error ?? "Falha ao enviar resposta.");
        if (data?.moderation?.flags) setReplyFlags(data.moderation.flags);
        return;
      }
      const out = (await res.json().catch(() => null)) as { id?: string } | null;
      setReplyOk("Resposta enviada. Você pode anexar arquivos abaixo.");
      setLastResponseId(out?.id ?? null);
      setReply("");
    } finally {
      setSending(false);
    }
  }

  async function sendContest() {
    setSending(true);
    setContestOk(null);
    setContestError(null);
    try {
      const res = await fetch(`/api/complaints/${props.complaintId}/company-contest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ legalReason: contestReason, message: contestMessage }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setContestError(data?.error ?? "Falha ao enviar contestação.");
        return;
      }
      setContestOk("Contestação enviada para análise.");
      setContestMessage("");
      setContestReason("");
    } finally {
      setSending(false);
    }
  }

  async function uploadAttachment() {
    if (!lastResponseId || !file) return;
    setUploading(true);
    setUploadOk(null);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(
        `/api/complaints/${props.complaintId}/responses/${lastResponseId}/attachments`,
        { method: "POST", body: form },
      );
      if (!res.ok) {
        const out = (await res.json().catch(() => null)) as { error?: string } | null;
        setUploadError(out?.error ?? "Falha ao enviar anexo.");
        return;
      }
      setFile(null);
      setUploadOk("Anexo enviado com sucesso.");
    } finally {
      setUploading(false);
    }
  }

  function applyTemplate(id: string) {
    const tpl = templates.find((t) => t.id === id);
    if (!tpl) return;
    setReply(tpl.message);
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 space-y-3">
        <div className="font-title font-bold text-lg">Responder reclamação</div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <label className="text-sm block">
            <div className="text-foreground/70 mb-1">Templates prontos</div>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="h-10 w-full rounded-xl border border-black/10 bg-white px-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <Button variant="secondary" onClick={() => applyTemplate(templateId)}>
              Aplicar
            </Button>
          </div>
        </div>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Nome do responsável (opcional)</div>
          <Input
            value={authorName}
            onChange={(e) => setAuthorName(e.target.value)}
            placeholder="Ex.: Equipe Técnica"
          />
        </label>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Mensagem</div>
          <textarea
            className="w-full min-h-32 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Explique a ação, prazos e próximos passos. Evite dados pessoais."
          />
        </label>
        <div className="text-xs text-foreground/60">
          A resposta deve ser clara, empática, objetiva, transparente e indicar ação.
        </div>
        {replyError ? (
          <div
            className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
            role="alert"
            aria-live="assertive"
          >
            <div>{replyError}</div>
            {issues.length ? (
              <ul className="mt-2 list-disc pl-5">
                {issues.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {replyOk ? (
          <div className="rounded-xl bg-[#ecfff2] px-4 py-3 text-sm text-[#0d6b2f]" role="status" aria-live="polite">
            {replyOk}
          </div>
        ) : null}
        <Button disabled={sending || reply.trim().length < 5} onClick={sendReply}>
          {sending ? "Enviando..." : "Enviar resposta"}
        </Button>

        <div className="mt-4 border-t border-black/10 pt-4 space-y-2">
          <div className="font-title font-semibold">Anexos da resposta</div>
          <div className="text-sm text-foreground/70">
            Envie PDFs ou fotos (JPEG/PNG/WebP). Não inclua dados pessoais.
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="file"
              aria-label="Selecionar anexo para a resposta"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <Button disabled={!lastResponseId || !file || uploading} variant="secondary" onClick={uploadAttachment}>
              {uploading ? "Enviando..." : "Enviar anexo"}
            </Button>
          </div>
          {uploadOk ? (
            <div className="rounded-xl bg-[#ecfff2] px-4 py-3 text-sm text-[#0d6b2f]" role="status" aria-live="polite">
              {uploadOk}
            </div>
          ) : null}
          {uploadError ? (
            <div
              className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
              role="alert"
              aria-live="assertive"
            >
              {uploadError}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <div className="font-title font-bold text-lg">Contestar conteúdo (jurídico)</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="text-xs rounded-full bg-primary/10 text-primary px-3 py-1 font-title font-semibold hover:bg-primary/15"
            onClick={() => setContestReason("Dados pessoais expostos")}
          >
            Dados pessoais
          </button>
          <button
            type="button"
            className="text-xs rounded-full bg-primary/10 text-primary px-3 py-1 font-title font-semibold hover:bg-primary/15"
            onClick={() => setContestReason("Acusações criminais sem comprovação")}
          >
            Acusação criminal
          </button>
          <button
            type="button"
            className="text-xs rounded-full bg-primary/10 text-primary px-3 py-1 font-title font-semibold hover:bg-primary/15"
            onClick={() => setContestReason("Informações falsas comprovadas")}
          >
            Informação falsa
          </button>
          <button
            type="button"
            className="text-xs rounded-full bg-primary/10 text-primary px-3 py-1 font-title font-semibold hover:bg-primary/15"
            onClick={() => setContestReason("Anexos sensíveis")}
          >
            Anexo sensível
          </button>
        </div>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Motivo (opcional)</div>
          <Input
            value={contestReason}
            onChange={(e) => setContestReason(e.target.value)}
            placeholder="Ex.: alegação de difamação / dados pessoais / ordem judicial"
          />
        </label>
        <label className="text-sm block">
          <div className="text-foreground/70 mb-1">Detalhes</div>
          <textarea
            className="w-full min-h-28 rounded-xl border border-black/10 bg-white px-4 py-3 outline-none ring-offset-2 transition focus:ring-2 focus:ring-secondary"
            value={contestMessage}
            onChange={(e) => setContestMessage(e.target.value)}
            placeholder="Explique o que deve ser revisado e por quê."
          />
        </label>
        {contestError ? (
          <div
            className="rounded-xl bg-[#ffefef] px-4 py-3 text-sm text-[#8a1f1f]"
            role="alert"
            aria-live="assertive"
          >
            {contestError}
          </div>
        ) : null}
        {contestOk ? (
          <div className="rounded-xl bg-[#ecfff2] px-4 py-3 text-sm text-[#0d6b2f]" role="status" aria-live="polite">
            {contestOk}
          </div>
        ) : null}
        <Button
          variant="secondary"
          disabled={sending || contestMessage.trim().length < 10}
          onClick={sendContest}
        >
          {sending ? "Enviando..." : "Enviar contestação"}
        </Button>
      </Card>
    </div>
  );
}
