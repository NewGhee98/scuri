import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { getFormat } from "./formats";
import { validateTemplate } from "./templates";
import type { CustomTemplate, FormatId, NormalizedFrame } from "./types";

const CUSTOM_TEMPLATES_KEY = "layouts.custom-templates.v1";

interface StoredCustomTemplateLibrary {
  version: 1;
  templates: CustomTemplate[];
}

interface TemplateRow {
  id: string;
  owner_id: string;
  name: string;
  format_id: FormatId;
  background: string;
  frames: NormalizedFrame[];
  status: "draft" | "saved";
  source_template_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateSyncSummary {
  uploaded: number;
  downloaded: number;
  removed: number;
  failed: number;
}

export interface TemplateSyncPlan {
  templates: CustomTemplate[];
  uploads: CustomTemplate[];
  downloaded: number;
  removed: number;
}

let browserClient: SupabaseClient | null = null;

export function isTemplateCloudConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getTemplateCloudClient(): SupabaseClient | null {
  if (!isTemplateCloudConfigured()) return null;
  if (!browserClient) {
    browserClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }
  return browserClient;
}

function isFormatId(value: unknown): value is FormatId {
  return value === "instagram-post" || value === "instagram-square" || value === "instagram-story";
}

function isCustomTemplate(value: unknown): value is CustomTemplate {
  if (!value || typeof value !== "object") return false;
  const template = value as Partial<CustomTemplate>;
  if (
    template.source !== "custom" ||
    typeof template.id !== "string" ||
    typeof template.name !== "string" ||
    !isFormatId(template.formatId) ||
    !Array.isArray(template.frames) ||
    (template.status !== "draft" && template.status !== "saved") ||
    typeof template.createdAt !== "string" ||
    typeof template.updatedAt !== "string"
  ) return false;
  const candidate = template as CustomTemplate;
  return validateTemplate({
    id: candidate.id,
    name: candidate.name,
    formatId: candidate.formatId,
    canvasWidth: candidate.canvasWidth,
    canvasHeight: candidate.canvasHeight,
    defaultBackground: candidate.defaultBackground,
    defaultGutter: candidate.defaultGutter,
    frameInsetMultiplier: candidate.frameInsetMultiplier,
    frames: candidate.frames,
  }).length === 0 || candidate.status === "draft";
}

export function loadCachedCustomTemplates(): CustomTemplate[] {
  const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
  if (!raw) return [];
  try {
    const library = JSON.parse(raw) as StoredCustomTemplateLibrary;
    if (library.version !== 1 || !Array.isArray(library.templates)) return [];
    return library.templates.filter(isCustomTemplate);
  } catch {
    return [];
  }
}

export function cacheCustomTemplates(templates: readonly CustomTemplate[]): void {
  const library: StoredCustomTemplateLibrary = { version: 1, templates: [...templates] };
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(library));
}

export function createBlankCustomTemplate(formatId: FormatId, name = "Untitled template"): CustomTemplate {
  const format = getFormat(formatId);
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    formatId,
    canvasWidth: format.width,
    canvasHeight: format.height,
    defaultBackground: "#ffffff",
    defaultGutter: 0,
    frames: [],
    source: "custom",
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
    syncState: "local",
  };
}

export function copyAsCustomTemplate(
  template: Pick<CustomTemplate, keyof CustomTemplate> | {
    id: string;
    name: string;
    formatId: FormatId;
    canvasWidth: number;
    canvasHeight: number;
    defaultBackground: string;
    defaultGutter: number;
    frames: NormalizedFrame[];
  },
  existingNames: readonly string[],
): CustomTemplate {
  const baseName = `${template.name} copy`;
  let name = baseName;
  let suffix = 2;
  while (existingNames.some((candidate) => candidate.toLowerCase() === name.toLowerCase())) {
    name = `${baseName} ${suffix}`;
    suffix += 1;
  }
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    formatId: template.formatId,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    defaultBackground: template.defaultBackground,
    defaultGutter: 0,
    frames: template.frames.map((frame) => ({ ...frame, id: crypto.randomUUID() })),
    source: "custom",
    status: "draft",
    sourceTemplateId: template.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    syncState: "local",
  };
}

function rowToTemplate(row: TemplateRow): CustomTemplate {
  const format = getFormat(row.format_id);
  return {
    id: row.id,
    name: row.name,
    formatId: row.format_id,
    canvasWidth: format.width,
    canvasHeight: format.height,
    defaultBackground: row.background,
    defaultGutter: 0,
    frames: row.frames,
    source: "custom",
    status: row.status,
    sourceTemplateId: row.source_template_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncState: "synced",
  };
}

export async function getTemplateCloudUser(): Promise<User | null> {
  const client = getTemplateCloudClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function sendTemplateMagicLink(email: string): Promise<void> {
  const client = getTemplateCloudClient();
  if (!client) throw new Error("Template cloud storage has not been connected yet.");
  const { error } = await client.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOutTemplateCloud(): Promise<void> {
  const client = getTemplateCloudClient();
  if (!client) return;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

export async function loadCloudTemplates(): Promise<CustomTemplate[]> {
  const client = getTemplateCloudClient();
  if (!client) return [];
  const { data, error } = await client
    .from("templates")
    .select("id, owner_id, name, format_id, background, frames, status, source_template_id, created_at, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as TemplateRow[]).map(rowToTemplate).filter(isCustomTemplate);
}

export async function saveCloudTemplate(template: CustomTemplate): Promise<CustomTemplate> {
  const client = getTemplateCloudClient();
  if (!client) throw new Error("Template cloud storage has not been connected yet.");
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) throw new Error("Sign in before saving this template to the cloud.");
  const row = {
    id: template.id,
    owner_id: userData.user.id,
    name: template.name.trim(),
    format_id: template.formatId,
    background: template.defaultBackground,
    frames: template.frames,
    status: template.status,
    source_template_id: template.sourceTemplateId ?? null,
    created_at: template.createdAt,
    updated_at: template.updatedAt,
  };
  const { data, error } = await client
    .from("templates")
    .upsert(row, { onConflict: "id" })
    .select("id, owner_id, name, format_id, background, frames, status, source_template_id, created_at, updated_at")
    .single();
  if (error) throw error;
  return rowToTemplate(data as TemplateRow);
}

export async function deleteCloudTemplate(templateId: string): Promise<void> {
  const client = getTemplateCloudClient();
  if (!client) throw new Error("Template cloud storage has not been connected yet.");
  const { error } = await client.from("templates").delete().eq("id", templateId);
  if (error) throw error;
}

export function mergeTemplateLibraries(
  localTemplates: readonly CustomTemplate[],
  cloudTemplates: readonly CustomTemplate[],
): CustomTemplate[] {
  const merged = new Map<string, CustomTemplate>();
  for (const template of localTemplates) merged.set(template.id, template);
  for (const cloud of cloudTemplates) {
    const local = merged.get(cloud.id);
    if (!local || Date.parse(cloud.updatedAt) >= Date.parse(local.updatedAt) || local.syncState === "synced") {
      merged.set(cloud.id, cloud);
    }
  }
  return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createTemplateSyncPlan(
  localTemplates: readonly CustomTemplate[],
  cloudTemplates: readonly CustomTemplate[],
): TemplateSyncPlan {
  const localById = new Map(localTemplates.map((template) => [template.id, template]));
  const cloudById = new Map(cloudTemplates.map((template) => [template.id, template]));
  const removed = localTemplates.filter((template) => (
    template.syncState === "synced" && !cloudById.has(template.id)
  )).length;
  const retainedLocal = localTemplates.filter((template) => (
    template.syncState !== "synced" || cloudById.has(template.id)
  ));
  const templates = mergeTemplateLibraries(retainedLocal, cloudTemplates);
  const uploads = templates.filter((template) => {
    const cloud = cloudById.get(template.id);
    if (!cloud) return template.syncState !== "synced";
    return template.syncState !== "synced" && Date.parse(template.updatedAt) > Date.parse(cloud.updatedAt);
  });
  const downloaded = cloudTemplates.filter((cloud) => {
    const local = localById.get(cloud.id);
    if (!local) return true;
    const cloudWins = Date.parse(cloud.updatedAt) >= Date.parse(local.updatedAt) || local.syncState === "synced";
    return cloudWins && (cloud.updatedAt !== local.updatedAt || local.syncState !== "synced");
  }).length;

  return { templates, uploads, downloaded, removed };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function describeTemplateSync(summary: TemplateSyncSummary): string {
  if (summary.failed > 0) {
    const successfulChanges = summary.uploaded + summary.downloaded + summary.removed;
    const prefix = successfulChanges > 0 ? "Sync partly completed, but" : "Sync failed:";
    return `${prefix} ${countLabel(summary.failed, "template")} could not be saved to the cloud. Your local copy is unchanged.`;
  }

  const changes = [
    summary.uploaded ? `${countLabel(summary.uploaded, "template")} uploaded` : null,
    summary.downloaded ? `${countLabel(summary.downloaded, "cloud change")} downloaded` : null,
    summary.removed ? `${countLabel(summary.removed, "cloud deletion")} applied` : null,
  ].filter((item): item is string => Boolean(item));

  return changes.length > 0 ? `Sync complete: ${changes.join(", ")}.` : "Templates are already up to date.";
}
