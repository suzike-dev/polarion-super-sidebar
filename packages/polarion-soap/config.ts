import type { PolarionConfig } from "./types.js";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function csvEnv(name: string): string[] {
  const value = optionalEnv(name);
  return value
    ? [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))]
    : [];
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("POLARION_BASE_URL must use HTTPS, or HTTP for local development only.");
  }
  const localHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (
    parsed.protocol === "http:" &&
    !localHost &&
    optionalEnv("POLARION_ALLOW_INSECURE_HTTP") !== "true"
  ) {
    throw new Error(
      "POLARION_BASE_URL must use HTTPS. Set POLARION_ALLOW_INSECURE_HTTP=true only for an explicitly trusted test server."
    );
  }
  return trimmed;
}

export function loadConfig(): PolarionConfig {
  const baseUrl = optionalEnv("POLARION_BASE_URL");
  if (!baseUrl) {
    throw new Error(
      "POLARION_BASE_URL is required. Run the installer or set it to your Polarion portal URL."
    );
  }
  const authModeValue = optionalEnv("POLARION_AUTH_MODE") ?? "password";
  if (authModeValue !== "password" && authModeValue !== "access_token") {
    throw new Error("POLARION_AUTH_MODE must be 'password' or 'access_token'.");
  }

  const timeoutValue = optionalEnv("POLARION_TIMEOUT_MS") ?? "30000";
  const timeoutMs = Number(timeoutValue);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
    throw new Error("POLARION_TIMEOUT_MS must be an integer between 1000 and 120000.");
  }
  const configuredExportRoot = optionalEnv("POLARION_EXPORT_ROOT");
  if (configuredExportRoot && !isAbsolute(configuredExportRoot)) {
    throw new Error("POLARION_EXPORT_ROOT must be an absolute path.");
  }
  const exportRoot = resolve(configuredExportRoot ?? join(tmpdir(), "polarion-mcp-exports"));

  return {
    baseUrl: normalizeBaseUrl(baseUrl),
    projectId: optionalEnv("POLARION_PROJECT_ID") ?? "",
    defaultDocumentLocation: optionalEnv("POLARION_DOCUMENT_LOCATION") ?? "",
    authMode: authModeValue,
    username: optionalEnv("POLARION_USERNAME"),
    password: optionalEnv("POLARION_PASSWORD"),
    accessToken: optionalEnv("POLARION_ACCESS_TOKEN"),
    timeoutMs,
    exportRoot,
    writeEnabled: optionalEnv("POLARION_WRITES_ENABLED") !== "false",
    writeProjectIds: csvEnv("POLARION_WRITE_PROJECT_IDS"),
    writeDocumentLocations: csvEnv("POLARION_WRITE_DOCUMENT_LOCATIONS")
  };
}

export function credentialsConfigured(config: PolarionConfig): boolean {
  if (config.authMode === "access_token") {
    return Boolean(config.accessToken);
  }
  return Boolean(config.username && config.password);
}
