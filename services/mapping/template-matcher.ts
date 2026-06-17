import { db } from "@/core/db";
import { mappingTemplates } from "@/core/db/schema";
import { eq, and } from "drizzle-orm";
import { MappingTemplateConfig } from "@/core/db/types";

export function generateFingerprint(headers: string[]): string {
  return headers
    .map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
    .filter((h) => h.length > 0)
    .sort()
    .join(",");
}

export async function findMatchingTemplate(
  orgId: string,
  sourceType: string,
  headers: string[]
): Promise<{ id: string; templateName: string; config: MappingTemplateConfig } | null> {
  const templates = await db
    .select()
    .from(mappingTemplates)
    .where(
      and(
        eq(mappingTemplates.organizationId, orgId),
        eq(mappingTemplates.sourceType, sourceType)
      )
    );

  const targetFingerprint = generateFingerprint(headers);

  for (const t of templates) {
    const config = t.mapping as MappingTemplateConfig;
    if (config.headerFingerprint === targetFingerprint) {
      return {
        id: t.id,
        templateName: t.templateName || "Auto Matched Template",
        config,
      };
    }
  }

  return null;
}
export async function saveMappingTemplate(
  orgId: string,
  sourceType: string,
  templateName: string,
  columnMap: Record<string, string>,
  headers: string[]
): Promise<string> {
  const headerFingerprint = generateFingerprint(headers);
  const config: MappingTemplateConfig & { headerFingerprint: string } = {
    columnMap,
    dateFormat: "YYYY-MM-DD",
    ignoreHeader: true,
    headerFingerprint,
  };

  const [newTemplate] = await db
    .insert(mappingTemplates)
    .values({
      organizationId: orgId,
      sourceType,
      templateName,
      mapping: config,
    })
    .returning();

  return newTemplate.id;
}
