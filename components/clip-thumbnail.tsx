"use client";

import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";

import { resolveThumbnail } from "@/app/actions";

export function ClipThumbnail({
  contentId,
  videoUrl,
}: {
  contentId: string;
  videoUrl?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;
    resolveThumbnail(contentId, videoUrl)
      .then((r) => {
        if (!alive) return;
        setUrl(r.thumbnailUrl);
        setDone(true);
      })
      .catch(() => {
        if (alive) setDone(true);
      });
    return () => {
      alive = false;
    };
  }, [contentId, videoUrl]);

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt=""
        className="size-12 shrink-0 rounded-md border border-border object-cover"
      />
    );
  }

  return (
    <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
      {done ? (
        <ImageOff className="size-4" />
      ) : (
        <span className="size-3 animate-pulse rounded-full bg-smoke/40" />
      )}
    </div>
  );
}
