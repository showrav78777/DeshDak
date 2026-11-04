"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

function ModerationForm({ endpoint, version, active, publishedComment = false }: { endpoint: string; version: number; active: boolean; publishedComment?: boolean }) {
  const router = useRouter(); const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const decision = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
    const response = await fetch(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, reason: values.reason, version }) }); const result = await response.json(); setSaving(false);
    if (!response.ok) return setError(result.error?.message ?? "Could not apply the decision."); router.refresh();
  }
  return <form className="reel-moderation-form" onSubmit={submit}><label>Moderation reason<textarea maxLength={500} minLength={publishedComment ? 5 : undefined} required={publishedComment} name="reason" placeholder={publishedComment ? "Required removal reason" : active ? "Optional archive note" : "Required when rejecting"} /></label><div>{publishedComment ? <button className="button secondary" disabled={saving} value="REMOVE">Remove comment</button> : active ? <button className="button secondary" disabled={saving} value="ARCHIVE">Archive</button> : <><button className="button primary" disabled={saving} value="PUBLISH">Publish</button><button className="button secondary" disabled={saving} value="REJECT">Reject</button></>}</div>{error ? <p className="form-error" role="alert">{error}</p> : null}</form>;
}

export function ReelModeration({ reelId, version, active = false }: { reelId: string; version: number; active?: boolean }) {
  return <ModerationForm active={active} endpoint={`/api/v1/admin/reels/${reelId}`} version={version} />;
}

export function ReelCommentModeration({ commentId, version, published = false }: { commentId: string; version: number; published?: boolean }) {
  return <ModerationForm active={false} publishedComment={published} endpoint={`/api/v1/admin/reel-comments/${commentId}`} version={version} />;
}
