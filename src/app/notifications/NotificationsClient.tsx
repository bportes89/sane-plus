"use client";

import useSWR from "swr";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
};

type NotificationsDto =
  | { items: NotificationItem[]; unreadCount: number }
  | { error: string };

function canVibrate() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

async function playBeep() {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;
  const ctx = new AudioCtx();
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    await new Promise<void>((resolve) => {
      osc.onended = () => resolve();
    });
  } finally {
    try {
      await ctx.close();
    } catch {}
  }
}

function getPref(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function NotificationsClient({
  initial,
}: {
  initial: { items: NotificationItem[]; unreadCount: number };
}) {
  const { data } = useSWR<NotificationsDto>("/api/notifications?limit=40", fetcher, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
    fallbackData: initial,
  });

  const items = data && "items" in data ? data.items : initial.items;
  const unreadCount = data && "unreadCount" in data ? data.unreadCount : initial.unreadCount;

  const [announcement, setAnnouncement] = useState<string>("");
  const lastUnreadRef = useRef<number>(unreadCount);
  const initializedRef = useRef(false);

  useEffect(() => {
    const prev = lastUnreadRef.current;
    lastUnreadRef.current = unreadCount;
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }
    if (unreadCount <= prev) return;
    const delta = unreadCount - prev;

    const message = delta === 1 ? "Você recebeu 1 nova notificação." : `Você recebeu ${delta} novas notificações.`;
    const t = setTimeout(() => setAnnouncement(message), 0);

    const soundOn = getPref("saneplus.a11y.sound") === "on";
    const vibrateOn = getPref("saneplus.a11y.vibrate") === "on";

    if (soundOn) {
      void playBeep();
    }
    if (vibrateOn && canVibrate()) {
      try {
        navigator.vibrate([80, 40, 80]);
      } catch {}
    }
    return () => clearTimeout(t);
  }, [unreadCount]);

  const grouped = useMemo(() => items, [items]);

  return (
    <div>
      <div className="sr-only" role="status" aria-live="polite">
        {announcement}
      </div>

      <div className="mt-5 grid gap-2">
        {grouped.map((n) => (
          <Card key={n.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-title font-semibold">
                  {n.title} {n.readAt ? "" : "•"}
                </div>
                <div className="text-sm text-foreground/70 mt-1">{n.message}</div>
              </div>
              <div className="text-right text-xs text-foreground/60">
                <div>{new Date(n.createdAt).toLocaleString("pt-BR")}</div>
                <div>{n.readAt ? "Lida" : "Nova"}</div>
              </div>
            </div>
          </Card>
        ))}

        {!grouped.length ? (
          <Card className="p-5">
            <div className="text-sm text-foreground/70">Você ainda não tem notificações.</div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
