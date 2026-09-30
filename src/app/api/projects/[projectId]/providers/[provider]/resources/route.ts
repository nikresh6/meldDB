import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { encryptSecret, MeldError, providerIds, type ProviderId } from "@melddb/core";
import { NeonAdapter } from "@melddb/providers";
import { z } from "zod";
import { db } from "@/db";
import {
  credentialRecords,
  providerCapacitySnapshots,
  providerConnections,
  providerResources,
  provisioningOperations,
  shardPlacements,
} from "@/db/schema";
import { requireProjectAccess } from "@/lib/authorization";
import { errorResponse, requestId } from "@/lib/http";
import { providerAdapterForProject } from "@/lib/provider-service";
import { syncProviderResourceSchema } from "@/lib/schema-sync";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("attach"), externalId: z.string().min(1).max(255), connectionUri: z.string().url().optional() }),
  z.object({ action: z.literal("sync"), externalId: z.string().min(1).max(255) }),
  z.object({
    action: z.literal("create"),
    name: z.string().trim().min(2).max(120),
    region: z.string().trim().max(80).optional(),
    organizationId: z.string().trim().max(255).optional(),
  }),
]);

type RouteContext = { params: Promise<{ projectId: string; provider: string }> };

function parseProvider(value: string): ProviderId {
  if (!providerIds.includes(value as ProviderId)) {
    throw new MeldError({ code: "INVALID_INPUT", message: "Unknown database provider.", status: 400 });
  }
  return value as ProviderId;
}

async function storeConnectionUri(connectionId: string, externalId: string, value: string) {
  const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!key) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Provider encryption is not configured.", status: 503 });
  const kind = `resource:${externalId}:connection_uri`;
  const encrypted = encryptSecret(value, key, Number(process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "1"));
  await db.transaction(async (tx) => {
    await tx.delete(credentialRecords).where(and(eq(credentialRecords.connectionId, connectionId), eq(credentialRecords.kind, kind)));
    await tx.insert(credentialRecords).values({
      connectionId,
      kind,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      keyVersion: encrypted.version,
    });
  });
}

export async function GET(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId, provider: rawProvider } = await context.params;
    await requireProjectAccess(projectId, "viewer", request.headers);
    const provider = parseProvider(rawProvider);
    const { adapter, connection } = await providerAdapterForProject(projectId, provider);
    const [resources, capacity] = await Promise.all([adapter.listResources(), adapter.getAccountCapacity()]);
    await db.insert(providerCapacitySnapshots).values({
      connectionId: connection.id,
      provider,
      plan: capacity.plan,
      resourceLimit: capacity.knownFreeResourceLimit,
      resourcesUsed: capacity.actualResourcesUsed,
      resourcesRemaining: capacity.actualResourcesRemaining,
      storagePerResourceBytes: capacity.storagePerResourceBytes,
      accountStorageLimitBytes: capacity.accountStorageLimitBytes,
      accountStorageUsedBytes: capacity.accountStorageUsedBytes,
      source: capacity.source,
      checkedAt: new Date(capacity.lastCheckedAt),
    });
    const attached = await db.select().from(providerResources).where(and(eq(providerResources.projectId, projectId), eq(providerResources.provider, provider)));
    await Promise.allSettled(attached.map(async (resource) => {
      const [storage, health] = await Promise.all([adapter.getStorageUsage(resource.externalId), adapter.healthCheck(resource.externalId)]);
      await db.update(providerResources).set({
        storageUsedBytes: storage.usedBytes,
        storageLimitBytes: storage.limitBytes,
        latencyMs: health.latencyMs,
        state: health.state,
        lastCheckedAt: new Date(health.checkedAt),
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: new Date(),
      }).where(eq(providerResources.id, resource.id));
    }));
    return Response.json({
      data: resources,
      capacity,
      attachedExternalIds: attached.map((resource) => resource.externalId),
    }, { headers: { "x-request-id": id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const id = requestId(request);
  let operationId: string | undefined;
  let connectionId: string | undefined;
  try {
    const { projectId, provider: rawProvider } = await context.params;
    await requireProjectAccess(projectId, "admin", request.headers);
    const provider = parseProvider(rawProvider);
    const input = inputSchema.parse(await request.json());
    const resolved = await providerAdapterForProject(projectId, provider);
    connectionId = resolved.connection.id;

    const operation = (
      await db.insert(provisioningOperations).values({
        projectId,
        connectionId,
        provider,
        action: input.action,
        requestedName: input.action === "create" ? input.name : input.externalId,
        state: "running",
        completedSteps: ["credential_validated"],
      }).returning({ id: provisioningOperations.id })
    )[0];
    if (!operation) throw new Error("Provisioning operation was not created.");
    operationId = operation.id;
    await db.update(providerConnections).set({ state: "provisioning", updatedAt: new Date() }).where(eq(providerConnections.id, connectionId));

    let resource;
    let dataConnectionUri: string | undefined;

    if (input.action === "attach" || input.action === "sync") {
      if (provider === "neon" && resolved.adapter instanceof NeonAdapter) {
        const attached = await resolved.adapter.attachResourceWithCredentials(input.externalId);
        resource = attached.resource;
        dataConnectionUri = attached.connectionUri;
      } else {
        resource = await resolved.adapter.attachResource(input.externalId);
        if (input.action === "attach" && "connectionUri" in input) dataConnectionUri = input.connectionUri;
      }
    } else if (provider === "neon" && resolved.adapter instanceof NeonAdapter) {
      const created = await resolved.adapter.createResourceWithCredentials({
        name: input.name,
        region: input.region,
        organizationId: input.organizationId,
      });
      resource = created.resource;
      dataConnectionUri = created.connectionUri ?? undefined;
    } else {
      const databasePassword = provider === "supabase" ? randomBytes(32).toString("base64url") : undefined;
      resource = await resolved.adapter.createResource({
        name: input.name,
        region: input.region,
        organizationId: input.organizationId,
        databasePassword,
      });
      if (databasePassword) {
        const key = process.env.CREDENTIAL_ENCRYPTION_KEY;
        if (!key) throw new MeldError({ code: "CONFIGURATION_REQUIRED", message: "Provider encryption is not configured.", status: 503 });
        const encrypted = encryptSecret(databasePassword, key, Number(process.env.CREDENTIAL_ENCRYPTION_KEY_VERSION ?? "1"));
        await db.insert(credentialRecords).values({
          connectionId,
          kind: `resource:${resource.externalId}:database_password`,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.version,
        });
      }
    }

    if (dataConnectionUri) await storeConnectionUri(connectionId, resource.externalId, dataConnectionUri);

    const saved = (
      await db.insert(providerResources).values({
        projectId,
        connectionId,
        provider,
        externalId: resource.externalId,
        name: resource.name,
        resourceType: resource.type,
        dialect: resource.dialect,
        region: resource.region,
        state: resource.state,
        consoleUrl: resource.consoleUrl,
        metadata: resource.metadata,
      }).onConflictDoUpdate({
        target: [providerResources.provider, providerResources.externalId],
        set: {
          projectId,
          connectionId,
          name: resource.name,
          region: resource.region,
          state: resource.state,
          consoleUrl: resource.consoleUrl,
          metadata: resource.metadata,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date(),
        },
      }).returning()
    )[0];
    if (!saved) throw new Error("Provider resource was not persisted.");

    let schemaSync = null;
    if ((input.action === "attach" || input.action === "sync") && dataConnectionUri) {
      const dataPlane = await providerAdapterForProject(projectId, provider, resource.externalId);
      schemaSync = await syncProviderResourceSchema({
        projectId,
        resourceId: saved.id,
        externalId: resource.externalId,
        adapter: dataPlane.adapter,
      });
    }

    const completedSteps = [
      "credential_validated",
      input.action === "create" ? "resource_created" : "resource_selected",
      "resource_attached",
      ...(dataConnectionUri ? ["data_access_verified"] : []),
      ...(schemaSync ? ["schema_synced"] : []),
      "health_verified",
    ];

    await db.update(provisioningOperations).set({
      state: "succeeded",
      externalResourceId: resource.externalId,
      completedSteps,
      updatedAt: new Date(),
    }).where(eq(provisioningOperations.id, operationId));

    await db.update(providerConnections).set({
      state: "healthy",
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: new Date(),
    }).where(eq(providerConnections.id, connectionId));

    return Response.json({ data: saved, operationId, schemaSync }, { status: 201, headers: { "x-request-id": id } });
  } catch (error) {
    if (operationId) {
      const message = error instanceof Error ? error.message : "Provider provisioning failed.";
      await db.update(provisioningOperations).set({
        state: "failed",
        errorCode: error instanceof MeldError ? error.code : "PROVIDER_ERROR",
        errorMessage: message,
        updatedAt: new Date(),
      }).where(eq(provisioningOperations.id, operationId)).catch(() => undefined);
    }
    if (connectionId) {
      await db.update(providerConnections).set({
        state: error instanceof MeldError && error.code === "QUOTA_FULL" ? "quota_full" : "error",
        lastErrorCode: error instanceof MeldError ? error.code : "PROVIDER_ERROR",
        lastErrorMessage: error instanceof Error ? error.message : "Provider provisioning failed.",
        updatedAt: new Date(),
      }).where(eq(providerConnections.id, connectionId)).catch(() => undefined);
    }
    return errorResponse(error, id);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const id = requestId(request);
  try {
    const { projectId, provider: rawProvider } = await context.params;
    await requireProjectAccess(projectId, "admin", request.headers);
    const provider = parseProvider(rawProvider);
    const input = z.object({
      externalId: z.string().min(1).max(255),
      confirmation: z.string().max(255),
      preserveProviderResource: z.literal(true),
    }).parse(await request.json());
    const rows = await db.select().from(providerResources).where(and(
      eq(providerResources.projectId, projectId),
      eq(providerResources.provider, provider),
      eq(providerResources.externalId, input.externalId),
    )).limit(1);
    const resource = rows[0];
    if (!resource) throw new MeldError({ code: "NOT_FOUND", message: "Attached provider resource not found.", status: 404 });
    if (input.confirmation !== resource.name) throw new MeldError({ code: "INVALID_INPUT", message: `Type ${resource.name} exactly to disconnect this resource.`, status: 400 });
    const placements = await db.select({ id: shardPlacements.id }).from(shardPlacements).where(eq(shardPlacements.providerResourceId, resource.id)).limit(1);
    if (placements.length) throw new MeldError({ code: "INVALID_INPUT", message: "This resource still hosts logical table placements. Move or remove those tables before disconnecting it.", status: 409 });
    const { adapter } = await providerAdapterForProject(projectId, provider, resource.externalId);
    await adapter.disconnectResource(resource.externalId);
    await db.delete(providerResources).where(eq(providerResources.id, resource.id));
    return Response.json({ data: { disconnected: true, providerResourcePreserved: true }, meta: { requestId: id } });
  } catch (error) {
    return errorResponse(error, id);
  }
}
