import Link from "next/link";
import { redirect } from "next/navigation";
import { provisionActor } from "@/lib/actor";
import { getAuthService } from "@/lib/auth";
import { getAISettingsRepository } from "@/lib/db";
import { removeAISettings, saveAISettings } from "./actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; removed?: string }> }) {
  const user = await (await getAuthService()).currentUser();
  if (!user) redirect("/auth");
  const actor = await provisionActor(user);
  const settings = await getAISettingsRepository().summary(actor.id);
  const query = await searchParams;
  return <main className="libraryShell">
    <Link className="back" href="/library">← Private library</Link>
    <p className="eyebrow">Private configuration</p>
    <h1>AI provider settings</h1>
    <p className="muted">Use any OpenAI-compatible provider that supports both chat completions and embeddings. Your API key is encrypted before storage and is never shown again.</p>
    {query.saved && <p className="notice">AI provider saved.</p>}
    {query.removed && <p className="notice">AI provider removed.</p>}
    <form action={saveAISettings} className="noteForm">
      <label className="field"><span>API base URL</span><input name="baseUrl" type="url" required defaultValue={settings.baseUrl ?? "https://api.openai.com/v1"} /></label>
      <label className="field"><span>API key</span><input name="apiKey" type="password" required autoComplete="new-password" placeholder={settings.configured ? "Enter a new key to update settings" : "Provider API key"} /></label>
      <label className="field"><span>Chat model</span><input name="chatModel" required defaultValue={settings.chatModel ?? "gpt-5-mini"} /></label>
      <label className="field"><span>Embedding model</span><input name="embeddingModel" required defaultValue={settings.embeddingModel ?? "text-embedding-3-small"} /></label>
      <button className="button" type="submit">{settings.configured ? "Update AI provider" : "Save AI provider"}</button>
    </form>
    {settings.configured && <form action={removeAISettings}><button className="button buttonSecondary" type="submit">Remove AI provider</button></form>}
  </main>;
}
