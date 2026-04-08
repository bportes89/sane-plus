export async function sendEmailUsingProvider(args: {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.MAIL_FROM || "no-reply@sane.plus";

  if (apiKey) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [args.to],
          subject: args.subject,
          html: args.html ?? undefined,
          text: args.text ?? undefined,
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "Erro ao enviar e-mail");
        return { ok: false, provider: "resend", error: msg };
      }
      return { ok: true, provider: "resend" };
    } catch (e) {
      return { ok: false, provider: "resend", error: (e as Error).message };
    }
  }

  // Fallback: simular envio para MVP
  return { ok: true, provider: "simulated" };
}

