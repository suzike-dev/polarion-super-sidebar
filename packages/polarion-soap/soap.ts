import { XMLParser } from "fast-xml-parser";
import { credentialsConfigured } from "./config.js";
import type {
  CommentMutationResult,
  ConnectionStatus,
  CustomFieldMutationResult,
  PolarionConfig,
  PolarionApproval,
  PolarionAttachment,
  PolarionBaseline,
  PolarionComment,
  PolarionCustomField,
  PolarionCustomFieldDefinition,
  PolarionCustomFieldInput,
  PolarionDocument,
  PolarionEnumOption,
  PolarionHistoryChange,
  PolarionLink,
  PolarionProject,
  PolarionProjectGroup,
  PolarionUserSummary,
  PolarionWorkflowAction,
  PolarionWorkItem,
  WorkItemWorkflowActions,
  WorkflowActionMutationResult,
  WorkItemLinkMutationResult,
  WorkItemMutationResult
} from "./types.js";

type UnknownRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

const SESSION_NAMESPACE = "http://ws.polarion.com/session";
const SESSION_SERVICE_NAMESPACE = "http://ws.polarion.com/SessionWebService-impl";
const TRACKER_SERVICE_NAMESPACE = "http://ws.polarion.com/TrackerWebService-impl";
const PROJECT_SERVICE_NAMESPACE = "http://ws.polarion.com/ProjectWebService-impl";
const TRACKER_TYPES_NAMESPACE = "http://ws.polarion.com/TrackerWebService-types";
const COMMON_TYPES_NAMESPACE = "http://ws.polarion.com/types";
const PROJECT_TYPES_NAMESPACE = "http://ws.polarion.com/ProjectWebService-types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  processEntities: false,
  trimValues: true
});
const MAX_SOAP_RESPONSE_BYTES = 20_000_000;

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function arrayMembers(value: unknown, memberName: string): unknown[] {
  if (isRecord(value) && Object.hasOwn(value, memberName)) return asArray(value[memberName]);
  return asArray(value);
}

function primitive(value: unknown): string | boolean | number | undefined {
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (isRecord(value)) {
    const text = value["#text"];
    if (typeof text === "string" || typeof text === "boolean" || typeof text === "number") {
      return text;
    }
  }
  return undefined;
}

function decodeXmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: '"'
  };
  return value.replace(
    /&#x([0-9a-fA-F]+);|&#([0-9]+);|&(amp|apos|gt|lt|quot);/g,
    (match, hex: string | undefined, decimal: string | undefined, entity: string | undefined) => {
      if (entity) return named[entity] ?? match;
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
  );
}

function stringValue(value: unknown): string | undefined {
  const result = primitive(value);
  return result === undefined ? undefined : decodeXmlEntities(String(result));
}

function booleanValue(value: unknown): boolean | undefined {
  const result = primitive(value);
  if (typeof result === "boolean") return result;
  if (result === "true") return true;
  if (result === "false") return false;
  return undefined;
}

function integerValue(value: unknown): number | undefined {
  const result = primitive(value);
  const parsed = typeof result === "number" ? result : Number(result);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function numberValue(value: unknown): number | undefined {
  const result = primitive(value);
  const parsed = typeof result === "number" ? result : Number(result);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findFirstByKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstByKey(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  if (Object.hasOwn(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findFirstByKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectIds(value: unknown, ids: Map<string, unknown>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectIds(item, ids);
    return;
  }
  if (!isRecord(value)) return;
  const id = stringValue(value["@_id"]);
  if (id) ids.set(id, value);
  for (const child of Object.values(value)) collectIds(child, ids);
}

function resolveReferences(value: unknown, ids: Map<string, unknown>, seen = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, ids, seen));
  if (!isRecord(value)) return value;

  const href = stringValue(value["@_href"]);
  if (href?.startsWith("#")) {
    const id = href.slice(1);
    if (seen.has(id)) return { unresolved_reference: id };
    const target = ids.get(id);
    if (target !== undefined) {
      return resolveReferences(target, ids, new Set([...seen, id]));
    }
  }

  const output: UnknownRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "@_id" || key === "@_href" || key.startsWith("@_xmlns")) continue;
    output[key] = resolveReferences(child, ids, seen);
  }
  return output;
}

function extractFault(parsed: unknown): string | undefined {
  const fault = findFirstByKey(parsed, "Fault");
  if (!isRecord(fault)) return undefined;
  return stringValue(fault.faultstring) ?? "Polarion SOAP request failed.";
}

export function unwrapSoapReturn(xml: string, returnTag: string): unknown {
  const parsed = parser.parse(xml) as unknown;
  const fault = extractFault(parsed);
  if (fault) throw new Error(fault);

  const ids = new Map<string, unknown>();
  collectIds(parsed, ids);
  const result = findFirstByKey(parsed, returnTag);
  if (result === undefined) return undefined;
  return resolveReferences(result, ids);
}

function enumId(value: unknown): string | undefined {
  if (isRecord(value)) return stringValue(value.id);
  return stringValue(value);
}

function textObject(value: unknown): {
  content?: string | undefined;
  type?: string | undefined;
} {
  if (!isRecord(value)) return { content: stringValue(value) };
  return { content: stringValue(value.content), type: stringValue(value.type) };
}

function normalizeLinks(value: unknown): PolarionLink[] {
  return asArray(value)
    .filter(isRecord)
    .map((link) => ({
      role: enumId(link.role),
      work_item_uri: stringValue(link.workItemURI),
      revision: stringValue(link.revision),
      suspect: booleanValue(link.suspect)
    }))
    .filter((link) => Object.values(link).some((entry) => entry !== undefined));
}

function normalizeCustomFields(value: unknown): PolarionCustomField[] {
  return arrayMembers(value, "Custom")
    .filter(isRecord)
    .map((field) => ({ key: stringValue(field.key) ?? "", value: field.value }))
    .filter((field) => field.key.length > 0);
}

function normalizeCustomFieldValue(value: unknown): unknown {
  if (isRecord(value)) {
    const text = textObject(value);
    if (text.content !== undefined) return { type: text.type, content: text.content };
    const id = enumId(value);
    if (id !== undefined) return id;
    const primitiveValue = primitive(value);
    if (primitiveValue !== undefined) return primitiveValue;
  }
  return primitive(value) ?? value;
}

function normalizeCustomFieldDefinition(value: unknown): PolarionCustomFieldDefinition | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  if (!id) return undefined;
  return {
    id,
    name: stringValue(value.name),
    description: stringValue(value.description),
    type: stringValue(value.type),
    multi: booleanValue(value.multi) ?? false,
    required: booleanValue(value.required) ?? false,
    depends_on: stringValue(value.dependsOn),
    default_value: normalizeCustomFieldValue(value.defaultValue)
  };
}

function customFieldValueXml(field: PolarionCustomFieldInput): string {
  if (field.value_type === "text") {
    if (typeof field.value !== "string") throw new Error(`Custom field '${field.key}' text value must be a string.`);
    return `<trk:value xsi:type="typ:Text"><typ:type>text/html</typ:type><typ:content>${escapeXml(field.value)}</typ:content><typ:contentLossy>false</typ:contentLossy></trk:value>`;
  }
  if (field.value_type === "enum") {
    if (typeof field.value !== "string") throw new Error(`Custom field '${field.key}' enum value must be a string option ID.`);
    return `<trk:value xsi:type="trk:EnumOptionId"><trk:id>${escapeXml(field.value)}</trk:id></trk:value>`;
  }
  const expected = field.value_type === "boolean" ? "boolean" : field.value_type === "integer" ? "number" : "string";
  if (typeof field.value !== expected) throw new Error(`Custom field '${field.key}' ${field.value_type} value has an invalid JavaScript type.`);
  const xsiType = field.value_type === "integer" ? "xsd:int" : field.value_type === "date" ? "xsd:date" : `xsd:${field.value_type}`;
  return `<trk:value xsi:type="${xsiType}">${escapeXml(String(field.value))}</trk:value>`;
}

function expectedCustomFieldValue(field: PolarionCustomFieldInput): unknown {
  if (field.value_type === "text") return { type: "text/html", content: field.value };
  return field.value;
}

function customFieldTypeIsCompatible(definition: PolarionCustomFieldDefinition, valueType: PolarionCustomFieldInput["value_type"]): boolean {
  const actual = (definition.type ?? "").toLowerCase();
  if (!actual) return false;
  const expectedTokens: Record<PolarionCustomFieldInput["value_type"], string[]> = {
    text: ["text"],
    string: ["string"],
    boolean: ["boolean"],
    integer: ["int", "integer"],
    enum: ["enumoption", "enum"],
    date: ["date"]
  };
  return expectedTokens[valueType].some((token) => actual.includes(token));
}

function normalizeUser(value: unknown): PolarionUserSummary | undefined {
  if (!isRecord(value)) return undefined;
  const user = {
    id: stringValue(value.id),
    name: stringValue(value.name),
    uri: stringValue(value["@_uri"] ?? value.uri)
  };
  return Object.values(user).some((entry) => entry !== undefined) ? user : undefined;
}

function normalizeUsers(value: unknown): PolarionUserSummary[] {
  return arrayMembers(value, "User").map(normalizeUser).filter((user): user is PolarionUserSummary => user !== undefined);
}

function normalizeStringArray(value: unknown): string[] {
  let members = asArray(value);
  if (isRecord(value)) {
    for (const key of ["string", "SubterraURI"]) {
      if (Object.hasOwn(value, key)) {
        members = asArray(value[key]);
        break;
      }
    }
  }
  return members.map(stringValue).filter((entry): entry is string => entry !== undefined);
}

function normalizeComments(value: unknown): PolarionComment[] {
  return arrayMembers(value, "Comment")
    .filter(isRecord)
    .map((comment) => {
      const text = textObject(comment.text);
      return {
        id: stringValue(comment.id),
        title: stringValue(comment.title),
        text: text.content,
        text_type: text.type,
        created: stringValue(comment.created),
        resolved: booleanValue(comment.resolved),
        author: normalizeUser(comment.author),
        parent_comment_uri: stringValue(comment.parentCommentURI),
        child_comment_uris: normalizeStringArray(comment.childCommentURIs),
        tags: arrayMembers(comment.tags, "EnumOptionId").map(enumId).filter((tag): tag is string => tag !== undefined),
        uri: stringValue(comment["@_uri"] ?? comment.uri)
      };
    });
}

function normalizeApprovals(value: unknown): PolarionApproval[] {
  return arrayMembers(value, "Approval")
    .filter(isRecord)
    .map((approval) => ({ status: enumId(approval.status), user: normalizeUser(approval.user) }));
}

function normalizeAttachments(value: unknown): PolarionAttachment[] {
  return arrayMembers(value, "Attachment")
    .filter(isRecord)
    .map((attachment) => ({
      id: stringValue(attachment.id),
      title: stringValue(attachment.title),
      file_name: stringValue(attachment.fileName),
      length: numberValue(attachment.length),
      updated: stringValue(attachment.updated),
      author: normalizeUser(attachment.author),
      uri: stringValue(attachment["@_uri"] ?? attachment.uri)
    }));
}

function normalizeHyperlinks(value: unknown) {
  return arrayMembers(value, "Hyperlink")
    .filter(isRecord)
    .map((link) => ({ role: enumId(link.role), uri: stringValue(link.uri) }))
    .filter((link) => Boolean(link.uri));
}

function normalizeWorkflowAction(value: unknown): PolarionWorkflowAction {
  const action = isRecord(value) ? value : {};
  return {
    action_id: integerValue(action.actionId),
    action_name: stringValue(action.actionName),
    native_action_id: stringValue(action.nativeActionId),
    target_status: enumId(action.targetStatus),
    required_features: normalizeStringArray(action.requiredFeatures),
    suggested_features: normalizeStringArray(action.suggestedFeatures),
    cleaned_features: normalizeStringArray(action.cleanedFeatures),
    unavailability_message: stringValue(action.unavailabilityMessage)
  };
}

export function normalizeWorkItem(value: unknown): PolarionWorkItem {
  const item = isRecord(value) ? value : {};
  const description = textObject(item.description);
  return {
    id: stringValue(item.id),
    title: stringValue(item.title),
    type: enumId(item.type),
    status: enumId(item.status),
    previous_status: enumId(item.previousStatus),
    priority: enumId(item.priority),
    severity: enumId(item.severity),
    resolution: enumId(item.resolution),
    description: description.content,
    description_type: description.type,
    outline_number: stringValue(item.outlineNumber),
    module_uri: stringValue(item.moduleURI),
    location: stringValue(item.location),
    uri: stringValue(item["@_uri"] ?? item.uri),
    created: stringValue(item.created),
    updated: stringValue(item.updated),
    due_date: stringValue(item.dueDate),
    author: normalizeUser(item.author),
    assignees: normalizeUsers(item.assignee),
    comments: normalizeComments(item.comments),
    approvals: normalizeApprovals(item.approvals),
    attachments: normalizeAttachments(item.attachments),
    hyperlinks: normalizeHyperlinks(item.hyperlinks),
    unresolvable: booleanValue(item["@_unresolvable"] ?? item.unresolvable),
    linked_work_items: normalizeLinks(item.linkedWorkItems),
    custom_fields: normalizeCustomFields(item.customFields)
  };
}

export function normalizeDocument(value: unknown): PolarionDocument {
  const item = isRecord(value) ? value : {};
  const homePageContent = textObject(item.homePageContent);
  return {
    id: stringValue(item.id),
    title: stringValue(item.title),
    type: enumId(item.type),
    status: enumId(item.status),
    location: stringValue(item.location),
    module_location: stringValue(item.moduleLocation),
    module_name: stringValue(item.moduleName),
    module_folder: stringValue(item.moduleFolder),
    uri: stringValue(item["@_uri"] ?? item.uri),
    project_id: isRecord(item.project) ? stringValue(item.project.id) : undefined,
    created: stringValue(item.created),
    updated: stringValue(item.updated),
    author: normalizeUser(item.author),
    updated_by: normalizeUser(item.updatedBy),
    home_page_content: homePageContent.content,
    home_page_content_type: homePageContent.type
  };
}

export function normalizeProjectGroup(value: unknown): PolarionProjectGroup {
  const item = isRecord(value) ? value : {};
  return {
    name: stringValue(item.name),
    location: stringValue(item.location),
    parent_uri: stringValue(item.parentURI),
    group_uris: normalizeStringArray(item.groupURIs),
    project_ids: normalizeStringArray(item.projectIDs),
    uri: stringValue(item["@_uri"] ?? item.uri),
    unresolvable: booleanValue(item["@_unresolvable"] ?? item.unresolvable)
  };
}

export function normalizeProject(value: unknown): PolarionProject {
  const item = isRecord(value) ? value : {};
  return {
    id: stringValue(item.id),
    name: stringValue(item.name),
    description: stringValue(item.description),
    active: booleanValue(item.active),
    location: stringValue(item.location),
    project_group_uri: stringValue(item.projectGroupURI),
    tracker_prefix: stringValue(item.trackerPrefix),
    start: stringValue(item.start),
    finish: stringValue(item.finish),
    lead: normalizeUser(item.lead),
    uri: stringValue(item["@_uri"] ?? item.uri),
    unresolvable: booleanValue(item["@_unresolvable"] ?? item.unresolvable)
  };
}

function normalizeEnumOption(value: unknown): PolarionEnumOption {
  const item = isRecord(value) ? value : {};
  return {
    id: stringValue(item.id),
    name: stringValue(item.name),
    hidden: booleanValue(item.hidden),
    default: booleanValue(item.default),
    sequence_number: integerValue(item.sequenceNumber)
  };
}

function sanitizeError(message: string, config: PolarionConfig, additionalSecrets: string[] = []): string {
  let result = message;
  for (const secret of [config.password, config.accessToken, ...additionalSecrets]) {
    if (secret) result = result.replaceAll(secret, "[REDACTED]");
  }
  return result
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, "$1[REDACTED]")
    .replace(/(JSESSIONID=)[^;\s]+/gi, "$1[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeSoapBase64(encoded: string, label: string): Buffer {
  const normalized = encoded.replace(/\s+/g, "");
  if (normalized.length === 0 || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new Error(`${label} returned invalid Base64 content.`);
  }
  const decoded = Buffer.from(normalized, "base64");
  if (decoded.toString("base64") !== normalized) {
    throw new Error(`${label} returned non-canonical Base64 content.`);
  }
  return decoded;
}

function cookiePairs(headers: Headers): string | undefined {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const fallback = headers.get("set-cookie");
  const source = values.length > 0 ? values : fallback ? [fallback] : [];
  const pairs = source
    .map((entry) => entry.split(";", 1)[0]?.trim())
    .filter((entry): entry is string => Boolean(entry));
  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

/** A fault returned by the Polarion SOAP server itself, as opposed to a transport error or timeout. */
class SoapFaultError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SoapFaultError";
  }
}

// Polarion drops idle SOAP sessions on the server; calls that still carry the old session get this fault.
function isSessionExpiredFault(error: unknown): error is SoapFaultError {
  return error instanceof SoapFaultError && /^not authorized\b/i.test(error.message);
}

// Credentials are read once at startup, so a rejected login cannot start succeeding later in the same process.
function isLoginRejectedFault(error: unknown): error is SoapFaultError {
  return error instanceof SoapFaultError && /AuthenticationFailed/i.test(error.message);
}

export class PolarionSoapClient {
  private sessionId: string | undefined;
  private cookie: string | undefined;
  private authenticated = false;
  private loginRejection?: string;

  public constructor(
    private readonly config: PolarionConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  private serviceUrl(
    service: "SessionWebService" | "TrackerWebService" | "ProjectWebService"
  ): string {
    return `${this.config.baseUrl}/ws/services/${service}`;
  }

  private async request(
    service: "SessionWebService" | "TrackerWebService" | "ProjectWebService",
    namespace: string,
    operation: string,
    body: string,
    includeSession = true
  ): Promise<string> {
    try {
      return await this.sendRequest(service, namespace, operation, body, includeSession);
    } catch (error: unknown) {
      if (!includeSession || !this.authenticated || !isSessionExpiredFault(error)) throw error;
      // The server expired our session: log in once more and replay this request once.
      // A second failure, including a rejected login, is reported as-is instead of being retried.
      this.authenticated = false;
      this.sessionId = undefined;
      this.cookie = undefined;
      await this.authenticate();
      return await this.sendRequest(service, namespace, operation, body, includeSession);
    }
  }

  private async sendRequest(
    service: "SessionWebService" | "TrackerWebService" | "ProjectWebService",
    namespace: string,
    operation: string,
    body: string,
    includeSession: boolean
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const sessionHeader =
      includeSession && this.sessionId
        ? `<pol:sessionID xmlns:pol="${SESSION_NAMESPACE}">${escapeXml(this.sessionId)}</pol:sessionID>`
        : "";
    const envelope = `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:svc="${namespace}" xmlns:trk="${TRACKER_TYPES_NAMESPACE}" xmlns:typ="${COMMON_TYPES_NAMESPACE}" xmlns:prj="${PROJECT_TYPES_NAMESPACE}">` +
      `<soapenv:Header>${sessionHeader}</soapenv:Header>` +
      `<soapenv:Body><svc:${operation}>${body}</svc:${operation}></soapenv:Body>` +
      `</soapenv:Envelope>`;

    try {
      const headers: Record<string, string> = {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: '""'
      };
      if (includeSession && this.cookie) headers.Cookie = this.cookie;

      const response = await this.fetchImpl(this.serviceUrl(service), {
        method: "POST",
        headers,
        body: envelope,
        redirect: "error",
        signal: controller.signal
      });
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > MAX_SOAP_RESPONSE_BYTES) {
        throw new Error(`Polarion SOAP response exceeds the ${MAX_SOAP_RESPONSE_BYTES}-byte safety limit.`);
      }
      let xml = "";
      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let received = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (received > MAX_SOAP_RESPONSE_BYTES) {
            await reader.cancel("SOAP response size limit exceeded");
            controller.abort();
            throw new Error(`Polarion SOAP response exceeds the ${MAX_SOAP_RESPONSE_BYTES}-byte safety limit.`);
          }
          xml += decoder.decode(chunk.value, { stream: true });
        }
        xml += decoder.decode();
      } else {
        xml = await response.text();
        if (Buffer.byteLength(xml, "utf8") > MAX_SOAP_RESPONSE_BYTES) {
          throw new Error(`Polarion SOAP response exceeds the ${MAX_SOAP_RESPONSE_BYTES}-byte safety limit.`);
        }
      }
      const parsed = parser.parse(xml) as unknown;
      const fault = extractFault(parsed);
      if (fault) throw new SoapFaultError(fault);
      if (!response.ok) throw new Error(`Polarion returned HTTP ${response.status}.`);

      const responseSessionId = stringValue(findFirstByKey(parsed, "sessionID"));
      if (responseSessionId) this.sessionId = responseSessionId;
      const responseCookie = cookiePairs(response.headers);
      if (responseCookie) this.cookie = responseCookie;
      return xml;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Polarion request timed out after ${this.config.timeoutMs} ms.`);
      }
      const sanitized = sanitizeError(message, this.config, [this.sessionId ?? "", this.cookie ?? ""]);
      throw error instanceof SoapFaultError ? new SoapFaultError(sanitized) : new Error(sanitized);
    } finally {
      clearTimeout(timer);
    }
  }

  public async authenticate(): Promise<void> {
    if (this.authenticated) return;
    if (this.loginRejection) {
      throw new Error(
        `${this.loginRejection} Automatic login is paused for this server process to avoid locking the account; ` +
          "fix the credentials and restart the MCP server."
      );
    }
    if (!credentialsConfigured(this.config)) {
      throw new Error(
        this.config.authMode === "password"
          ? "Polarion credentials are not configured. Set POLARION_USERNAME and POLARION_PASSWORD before starting Codex."
          : "Polarion access token is not configured. Set POLARION_ACCESS_TOKEN before starting Codex."
      );
    }

    let operation: string;
    let body: string;
    if (this.config.authMode === "access_token") {
      operation = "logInWithToken";
      body = `<svc:mechanism>AccessToken</svc:mechanism><svc:username></svc:username>` +
        `<svc:token>${escapeXml(this.config.accessToken ?? "")}</svc:token>`;
    } else {
      operation = "logIn";
      body = `<svc:userName>${escapeXml(this.config.username ?? "")}</svc:userName>` +
        `<svc:password>${escapeXml(this.config.password ?? "")}</svc:password>`;
    }
    try {
      await this.request(
        "SessionWebService",
        SESSION_SERVICE_NAMESPACE,
        operation,
        body,
        false
      );
    } catch (error: unknown) {
      if (isLoginRejectedFault(error)) this.loginRejection = error.message;
      throw error;
    }
    if (!this.sessionId) {
      throw new Error("Polarion accepted the login request but did not return a SOAP session ID.");
    }
    this.authenticated = true;
  }

  public async status(): Promise<ConnectionStatus> {
    const wsdlUrl = `${this.serviceUrl("TrackerWebService")}?wsdl`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let status = 0;
    try {
      const response = await this.fetchImpl(wsdlUrl, {
        redirect: "error",
        signal: controller.signal
      });
      status = response.status;
      const reachable = response.ok;
      const configured = credentialsConfigured(this.config);
      let authenticated = false;
      let message = reachable
        ? "Tracker WSDL is reachable."
        : `Tracker WSDL returned HTTP ${response.status}.`;
      if (reachable && configured) {
        try {
          await this.authenticate();
          authenticated = true;
          message = "Tracker WSDL is reachable and SOAP authentication succeeded.";
        } catch (error: unknown) {
          message = `Tracker WSDL is reachable, but authentication failed: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      } else if (reachable && !configured) {
        message += " Credentials are not configured, so authenticated reads were not attempted.";
      }
      return {
        server: this.config.baseUrl,
        project_id: this.config.projectId,
        wsdl_reachable: reachable,
        wsdl_status: status,
        authentication_mode: this.config.authMode,
        credentials_configured: configured,
        authenticated,
        writes_enabled: this.config.writeEnabled !== false,
        write_project_allowlist: this.config.writeProjectIds ?? [],
        write_document_allowlist: this.config.writeDocumentLocations ?? [],
        message
      };
    } catch (error: unknown) {
      return {
        server: this.config.baseUrl,
        project_id: this.config.projectId,
        wsdl_reachable: false,
        wsdl_status: status,
        authentication_mode: this.config.authMode,
        credentials_configured: credentialsConfigured(this.config),
        authenticated: false,
        writes_enabled: this.config.writeEnabled !== false,
        write_project_allowlist: this.config.writeProjectIds ?? [],
        write_document_allowlist: this.config.writeDocumentLocations ?? [],
        message: sanitizeError(error instanceof Error ? error.message : String(error), this.config)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  public async getWorkItem(projectId: string, workItemId: string): Promise<PolarionWorkItem> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getWorkItemById",
      `<svc:projectId>${escapeXml(projectId)}</svc:projectId>` +
        `<svc:workitemId>${escapeXml(workItemId)}</svc:workitemId>`
    );
    return normalizeWorkItem(unwrapSoapReturn(xml, "getWorkItemByIdReturn"));
  }

  public async listWorkItemWorkflowActions(
    projectId: string,
    workItemId: string
  ): Promise<WorkItemWorkflowActions> {
    const item = await this.getWorkItem(projectId, workItemId);
    if (!item.uri) throw new Error(`Work item '${workItemId}' did not return a URI.`);
    const [availableXml, unavailableXml] = await Promise.all([
      this.request(
        "TrackerWebService",
        TRACKER_SERVICE_NAMESPACE,
        "getAvailableActions",
        `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>`
      ),
      this.request(
        "TrackerWebService",
        TRACKER_SERVICE_NAMESPACE,
        "getUnavailableActions",
        `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>`
      )
    ]);
    return {
      project_id: projectId,
      work_item_id: workItemId,
      current_status: item.status,
      updated: item.updated,
      available: asArray(unwrapSoapReturn(availableXml, "getAvailableActionsReturn")).map(normalizeWorkflowAction),
      unavailable: asArray(unwrapSoapReturn(unavailableXml, "getUnavailableActionsReturn")).map(normalizeWorkflowAction)
    };
  }

  public async performWorkItemWorkflowAction(input: {
    projectId: string;
    workItemId: string;
    actionId: number;
    expectedUpdated?: string | undefined;
  }): Promise<WorkflowActionMutationResult> {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    if (input.expectedUpdated !== undefined && item.updated !== input.expectedUpdated) {
      throw new Error(
        `Work item '${input.workItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${item.updated ?? "unknown"}).`
      );
    }
    const availableXml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getAvailableActions",
      `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>`
    );
    const available = asArray(unwrapSoapReturn(availableXml, "getAvailableActionsReturn")).map(
      normalizeWorkflowAction
    );
    const action = available.find((entry) => entry.action_id === input.actionId);
    if (!action) {
      throw new Error(
        `Workflow action '${input.actionId}' is not currently available for work item '${input.workItemId}'. Call polarion_list_work_item_actions and choose an available action_id.`
      );
    }
    await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "performWorkflowAction",
      `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>` +
        `<svc:actionId>${input.actionId}</svc:actionId>`
    );
    const readback = await this.getWorkItem(input.projectId, input.workItemId);
    const verified = action.target_status
      ? readback.status === action.target_status
      : readback.updated !== item.updated || readback.status !== item.status;
    return {
      operation: "perform_workflow_action",
      project_id: input.projectId,
      work_item_id: input.workItemId,
      action_id: input.actionId,
      action_name: action.action_name,
      native_action_id: action.native_action_id,
      previous_status: item.status,
      target_status: action.target_status,
      actual_status: readback.status,
      executed: true,
      verified,
      item: readback
    };
  }

  public async addWorkItemComment(input: {
    projectId: string;
    workItemId: string;
    title: string;
    content: string;
    contentType: "text/plain" | "text/html";
    expectedUpdated?: string | undefined;
  }): Promise<CommentMutationResult> {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    if (input.expectedUpdated !== undefined && item.updated !== input.expectedUpdated) {
      throw new Error(
        `Work item '${input.workItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${item.updated ?? "unknown"}).`
      );
    }
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "addComment",
      `<svc:parentObjectUri>${escapeXml(item.uri)}</svc:parentObjectUri>` +
        `<svc:title>${escapeXml(input.title)}</svc:title>` +
        `<svc:content><typ:type>${escapeXml(input.contentType)}</typ:type>` +
        `<typ:content>${escapeXml(input.content)}</typ:content><typ:contentLossy>false</typ:contentLossy></svc:content>`
    );
    const commentUri = stringValue(unwrapSoapReturn(xml, "addCommentReturn"));
    if (!commentUri) throw new Error("Polarion added the comment but did not return its URI.");
    const readback = await this.getWorkItem(input.projectId, input.workItemId);
    const comment = readback.comments.find((entry) => entry.uri === commentUri);
    const verified = Boolean(
      comment && comment.title === input.title && comment.text === input.content
    );
    return {
      operation: "add_comment",
      project_id: input.projectId,
      work_item_id: input.workItemId,
      comment_id: comment?.id,
      comment_uri: commentUri,
      executed: true,
      verified,
      comment
    };
  }

  public async setWorkItemCommentResolved(input: {
    projectId: string;
    workItemId: string;
    commentId: string;
    resolved: boolean;
    expectedUpdated?: string | undefined;
  }): Promise<CommentMutationResult> {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (input.expectedUpdated !== undefined && item.updated !== input.expectedUpdated) {
      throw new Error(
        `Work item '${input.workItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${item.updated ?? "unknown"}).`
      );
    }
    const comment = item.comments.find((entry) => entry.id === input.commentId);
    if (!comment?.uri) {
      throw new Error(`Comment '${input.commentId}' was not found on work item '${input.workItemId}'.`);
    }
    await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "setResolvedComment",
      `<svc:commentURI>${escapeXml(comment.uri)}</svc:commentURI>` +
        `<svc:resolved>${input.resolved}</svc:resolved>`
    );
    const verificationXml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "isResolvedComment",
      `<svc:commentURI>${escapeXml(comment.uri)}</svc:commentURI>`
    );
    const resolved = booleanValue(unwrapSoapReturn(verificationXml, "isResolvedCommentReturn"));
    return {
      operation: "set_comment_resolved",
      project_id: input.projectId,
      work_item_id: input.workItemId,
      comment_id: input.commentId,
      comment_uri: comment.uri,
      resolved,
      executed: true,
      verified: resolved === input.resolved,
      comment: { ...comment, resolved }
    };
  }

  public async listLinkRoles(projectId: string): Promise<PolarionEnumOption[]> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getAllEnumOptionsForId",
      `<svc:projectID>${escapeXml(projectId)}</svc:projectID>` +
        `<svc:enumID>workitem-link-role</svc:enumID>`
    );
    return asArray(unwrapSoapReturn(xml, "getAllEnumOptionsForIdReturn"))
      .map(normalizeEnumOption)
      .filter((option) => Boolean(option.id));
  }

  public async listProjectUsers(projectId: string): Promise<PolarionUserSummary[]> {
    await this.authenticate();
    const xml = await this.request(
      "ProjectWebService", PROJECT_SERVICE_NAMESPACE, "getProjectUsers",
      `<svc:projectID>${escapeXml(projectId)}</svc:projectID>`
    );
    return asArray(unwrapSoapReturn(xml, "getProjectUsersReturn"))
      .map(normalizeUser).filter((user): user is PolarionUserSummary => user !== undefined);
  }

  public async getCurrentUser(): Promise<PolarionUserSummary> {
    if (!this.config.username) {
      throw new Error("Current user lookup requires POLARION_USERNAME; token-only sessions do not expose a SOAP current-user operation.");
    }
    await this.authenticate();
    const xml = await this.request(
      "ProjectWebService", PROJECT_SERVICE_NAMESPACE, "getUser",
      `<svc:userID>${escapeXml(this.config.username)}</svc:userID>`
    );
    const user = normalizeUser(unwrapSoapReturn(xml, "getUserReturn"));
    if (!user) throw new Error(`Polarion user '${this.config.username}' could not be read.`);
    return { ...user, id: user.id ?? this.config.username };
  }

  public async listAllowedAssignees(projectId: string, workItemId: string): Promise<PolarionUserSummary[]> {
    const item = await this.getWorkItem(projectId, workItemId);
    if (!item.uri) throw new Error(`Work item '${workItemId}' did not return a URI.`);
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "getAllowedAssignees",
      `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>`
    );
    return asArray(unwrapSoapReturn(xml, "getAllowedAssigneesReturn"))
      .map(normalizeUser).filter((user): user is PolarionUserSummary => user !== undefined);
  }

  public async manageAssignee(input: { projectId: string; workItemId: string; userId: string; operation: "add" | "remove" }) {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    const operation = input.operation === "add" ? "addAssignee" : "removeAssignee";
    await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, operation,
      `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI><svc:assigneeId>${escapeXml(input.userId)}</svc:assigneeId>`
    );
    const readback = await this.getWorkItem(input.projectId, input.workItemId);
    const present = readback.assignees.some((user) => user.id === input.userId);
    return { operation: `${input.operation}_assignee`, project_id: input.projectId, work_item_id: input.workItemId, user_id: input.userId, executed: true, verified: input.operation === "add" ? present : !present, item: readback };
  }

  public async manageApproval(input: { projectId: string; workItemId: string; userId: string; operation: "add" | "set_status" | "remove"; status?: string | undefined }) {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    let operation: string;
    let body = `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI><svc:approveeId>${escapeXml(input.userId)}</svc:approveeId>`;
    if (input.operation === "add") operation = "addApprovee";
    else if (input.operation === "remove") operation = "removeApprovee";
    else {
      if (!input.status) throw new Error("Approval status is required for set_status.");
      operation = "editApproval";
      body += `<svc:status><trk:id>${escapeXml(input.status)}</trk:id></svc:status>`;
    }
    await this.request("TrackerWebService", TRACKER_SERVICE_NAMESPACE, operation, body);
    const readback = await this.getWorkItem(input.projectId, input.workItemId);
    const approval = readback.approvals.find((entry) => entry.user?.id === input.userId);
    const verified = input.operation === "remove" ? !approval : input.operation === "add" ? Boolean(approval) : approval?.status === input.status;
    return { operation: `${input.operation}_approval`, project_id: input.projectId, work_item_id: input.workItemId, user_id: input.userId, status: approval?.status, executed: true, verified, item: readback };
  }

  public async manageAttachment(input: { projectId: string; workItemId: string; operation: "create" | "update" | "delete"; attachmentId?: string | undefined; fileName?: string | undefined; title?: string | undefined; dataBase64?: string | undefined }) {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    if (input.operation !== "create" && !input.attachmentId) throw new Error("attachmentId is required for update/delete.");
    let operation: string;
    let body = `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>`;
    if (input.operation === "delete") {
      operation = "deleteAttachment";
      body += `<svc:id>${escapeXml(input.attachmentId ?? "")}</svc:id>`;
    } else {
      if (!input.fileName || input.title === undefined || !input.dataBase64) throw new Error("fileName, title and dataBase64 are required for create/update.");
      operation = input.operation === "create" ? "createAttachment" : "updateAttachment";
      if (input.operation === "update") body += `<svc:id>${escapeXml(input.attachmentId ?? "")}</svc:id>`;
      body += `<svc:fileName>${escapeXml(input.fileName)}</svc:fileName><svc:title>${escapeXml(input.title)}</svc:title><svc:data>${escapeXml(input.dataBase64)}</svc:data>`;
    }
    await this.request("TrackerWebService", TRACKER_SERVICE_NAMESPACE, operation, body);
    const readback = await this.getWorkItem(input.projectId, input.workItemId);
    const attachment = input.attachmentId ? readback.attachments.find((entry) => entry.id === input.attachmentId) : readback.attachments.find((entry) => entry.file_name === input.fileName && entry.title === input.title);
    const verified = input.operation === "delete" ? !attachment : Boolean(attachment);
    return { operation: `${input.operation}_attachment`, project_id: input.projectId, work_item_id: input.workItemId, attachment_id: attachment?.id ?? input.attachmentId, executed: true, verified, attachment, item: readback };
  }

  public async getWorkItemHistory(projectId: string, workItemId: string): Promise<PolarionHistoryChange[]> {
    const item = await this.getWorkItem(projectId, workItemId);
    if (!item.uri) throw new Error(`Work item '${workItemId}' did not return a URI.`);
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "generateHistory",
      `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI>`
    );
    return asArray(unwrapSoapReturn(xml, "generateHistoryReturn")).filter(isRecord).map((change) => {
      // Polarion 21 R2 把字段差异放在 diffs/item 下；旧版本/部分适配器使用 diffs/FieldDiff。
      // 两种结构都要接受，否则字段名会变成空串，变更历史看起来“什么都没有改”。
      const diffs = change.diffs;
      const members = isRecord(diffs) && Object.hasOwn(diffs, "FieldDiff")
        ? asArray(diffs.FieldDiff)
        : isRecord(diffs) && Object.hasOwn(diffs, "item")
          ? asArray(diffs.item)
          : asArray(diffs);
      // Text 字段的 content 仍是 XML 转义后的 HTML；统一还原成字符串，调用方才能直接参与比对。
      const historyValue = (value: unknown) => isRecord(value) && Object.hasOwn(value, "content") ? stringValue(value.content) : stringValue(value);
      return {
        revision: stringValue(change.revision), date: stringValue(change.date), user: normalizeUser(change.user),
        creation: booleanValue(change.creation), empty: booleanValue(change.empty), invalid: booleanValue(change.invalid),
        diffs: members.filter(isRecord).map((diff) => ({
          field_name: stringValue(diff.fieldName), before: historyValue(diff.before), after: historyValue(diff.after),
          added: historyValue(diff.added), removed: historyValue(diff.removed), collection: booleanValue(diff.collection)
        }))
      };
    });
  }

  public async queryBaselines(query: string, sort: string): Promise<PolarionBaseline[]> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "queryBaselines",
      `<svc:query>${escapeXml(query)}</svc:query><svc:sort>${escapeXml(sort)}</svc:sort>`
    );
    return asArray(unwrapSoapReturn(xml, "queryBaselinesReturn")).filter(isRecord).map((baseline) => ({
      id: stringValue(baseline.id), name: stringValue(baseline.name), description: stringValue(baseline.description),
      base_revision: stringValue(baseline.baseRevision), base_object_uri: stringValue(baseline.baseObjectURI),
      project_id: isRecord(baseline.project) ? stringValue(baseline.project.id) : undefined,
      author: normalizeUser(baseline.author), uri: stringValue(baseline["@_uri"] ?? baseline.uri),
      unresolvable: booleanValue(baseline["@_unresolvable"] ?? baseline.unresolvable)
    }));
  }

  public async manageHyperlink(input: { projectId: string; workItemId: string; operation: "add" | "remove"; url: string; role?: string | undefined; expectedUpdated?: string | undefined }) {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    if (input.expectedUpdated !== undefined && item.updated !== input.expectedUpdated) {
      throw new Error(
        `Work item '${input.workItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${item.updated ?? "unknown"}).`
      );
    }
    const matching = item.hyperlinks.filter((entry) => entry.uri === input.url);
    if (matching.length > 1) {
      throw new Error(`Hyperlink '${input.url}' has multiple roles on '${input.workItemId}'; URL-only mutation is unsafe.`);
    }
    if (input.operation === "add" && matching.length === 1) {
      if (matching[0]?.role !== input.role) {
        throw new Error(`Hyperlink '${input.url}' already exists with role '${matching[0]?.role ?? "unknown"}'; role replacement requires guarded reconciliation.`);
      }
      return { operation: "add_hyperlink" as const, project_id: input.projectId, work_item_id: input.workItemId, url: input.url, role: input.role, executed: false, verified: true, no_op: true, item };
    }
    if (input.operation === "remove" && matching.length === 0) {
      return { operation: "remove_hyperlink" as const, project_id: input.projectId, work_item_id: input.workItemId, url: input.url, role: input.role, executed: false, verified: true, no_op: true, item };
    }
    if (input.operation === "remove" && input.role && matching[0]?.role !== input.role) {
      throw new Error(`Hyperlink '${input.url}' has role '${matching[0]?.role ?? "unknown"}', not requested role '${input.role}'; URL-only removal was refused.`);
    }
    const operation = input.operation === "add" ? "addHyperlink" : "removeHyperlink";
    let body = `<svc:workitemURI>${escapeXml(item.uri)}</svc:workitemURI><svc:url>${escapeXml(input.url)}</svc:url>`;
    if (input.operation === "add") {
      if (!input.role) throw new Error("Hyperlink role is required when adding a hyperlink.");
      body += `<svc:role><trk:id>${escapeXml(input.role)}</trk:id></svc:role>`;
    }
    await this.request("TrackerWebService", TRACKER_SERVICE_NAMESPACE, operation, body);
    const readback = await this.getWorkItem(input.projectId, input.workItemId);
    const link = readback.hyperlinks.find((entry) => entry.uri === input.url);
    const verified = input.operation === "add" ? Boolean(link && link.role === input.role) : !link;
    return { operation: `${input.operation}_hyperlink`, project_id: input.projectId, work_item_id: input.workItemId, url: input.url, role: input.role, executed: true, verified, item: readback };
  }

  public async getBackLinkedWorkItems(workItemUri: string): Promise<PolarionLink[]> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getBackLinkedWorkitems",
      `<svc:workitemURI>${escapeXml(workItemUri)}</svc:workitemURI>`
    );
    return normalizeLinks(unwrapSoapReturn(xml, "getBackLinkedWorkitemsReturn"));
  }

  public async getDocument(projectId: string, location: string): Promise<PolarionDocument> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getModuleByLocation",
      `<svc:projectId>${escapeXml(projectId)}</svc:projectId>` +
        `<svc:location>${escapeXml(location)}</svc:location>`
    );
    return normalizeDocument(unwrapSoapReturn(xml, "getModuleByLocationReturn"));
  }

  public async listAccessibleProjects(rootGroupUri?: string): Promise<{
    root_group: PolarionProjectGroup;
    projects: PolarionProject[];
  }> {
    await this.authenticate();
    let rootGroup: PolarionProjectGroup;
    if (rootGroupUri) {
      rootGroup = {
        group_uris: [],
        project_ids: [],
        uri: rootGroupUri
      };
    } else {
      const rootXml = await this.request(
        "ProjectWebService",
        PROJECT_SERVICE_NAMESPACE,
        "getRootProjectGroup",
        ""
      );
      rootGroup = normalizeProjectGroup(unwrapSoapReturn(rootXml, "getRootProjectGroupReturn"));
    }
    if (!rootGroup.uri) throw new Error("Polarion root project group did not return a URI.");
    const projectsXml = await this.request(
      "ProjectWebService",
      PROJECT_SERVICE_NAMESPACE,
      "getDeepContainedProjects",
      `<svc:projectGroupURI>${escapeXml(rootGroup.uri)}</svc:projectGroupURI>`
    );
    const projects = asArray(unwrapSoapReturn(projectsXml, "getDeepContainedProjectsReturn"))
      .map(normalizeProject)
      .filter((project) => !project.unresolvable && Boolean(project.id));
    return { root_group: rootGroup, projects };
  }

  public async listProjectGroups(rootGroupUri: string | undefined, maxDepth: number, limit: number): Promise<{
    root_group: PolarionProjectGroup;
    groups: Array<PolarionProjectGroup & { depth: number }>;
    truncated: boolean;
  }> {
    await this.authenticate();
    let rootGroup: PolarionProjectGroup;
    if (rootGroupUri) {
      const rootXml = await this.request(
        "ProjectWebService", PROJECT_SERVICE_NAMESPACE, "getProjectGroup",
        `<svc:projectGroupURI>${escapeXml(rootGroupUri)}</svc:projectGroupURI>`
      );
      rootGroup = normalizeProjectGroup(unwrapSoapReturn(rootXml, "getProjectGroupReturn"));
    } else {
      const rootXml = await this.request("ProjectWebService", PROJECT_SERVICE_NAMESPACE, "getRootProjectGroup", "");
      rootGroup = normalizeProjectGroup(unwrapSoapReturn(rootXml, "getRootProjectGroupReturn"));
    }
    if (!rootGroup.uri) throw new Error("Polarion root project group did not return a URI.");
    const groups: Array<PolarionProjectGroup & { depth: number }> = [{ ...rootGroup, depth: 0 }];
    const seen = new Set([rootGroup.uri]);
    let cursor = 0;
    let truncated = false;
    while (cursor < groups.length) {
      const current = groups[cursor++]!;
      if (current.depth >= maxDepth) continue;
      const xml = await this.request(
        "ProjectWebService", PROJECT_SERVICE_NAMESPACE, "getContainedGroups",
        `<svc:projectGroupURI>${escapeXml(current.uri!)}</svc:projectGroupURI>`
      );
      for (const child of asArray(unwrapSoapReturn(xml, "getContainedGroupsReturn")).map(normalizeProjectGroup)) {
        if (!child.uri || child.unresolvable || seen.has(child.uri)) continue;
        if (groups.length >= limit) {
          truncated = true;
          break;
        }
        seen.add(child.uri);
        groups.push({ ...child, depth: current.depth + 1 });
      }
      if (truncated) break;
    }
    return { root_group: rootGroup, groups, truncated };
  }

  public async getProject(projectId: string): Promise<PolarionProject> {
    await this.authenticate();
    const xml = await this.request(
      "ProjectWebService", PROJECT_SERVICE_NAMESPACE, "getProject",
      `<svc:projectID>${escapeXml(projectId)}</svc:projectID>`
    );
    return normalizeProject(unwrapSoapReturn(xml, "getProjectReturn"));
  }

  public async countDocumentWorkItems(documentUri: string): Promise<number> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "getModuleWorkItemUris",
      `<svc:moduleURI>${escapeXml(documentUri)}</svc:moduleURI>` +
        `<svc:parentWorkItemURI xsi:nil="true"/>` +
        `<svc:deep>true</svc:deep>`
    );
    return asArray(unwrapSoapReturn(xml, "getModuleWorkItemUrisReturn"))
      .map(stringValue)
      .filter((value): value is string => Boolean(value)).length;
  }

  public async queryDocuments(
    projectId: string,
    query: string,
    sort: string,
    fields: string[],
    resultsLimit: number
  ): Promise<PolarionDocument[]> {
    await this.authenticate();
    const scopedQuery = query.trim()
      ? `project.id:${projectId} AND (${query.trim()})`
      : `project.id:${projectId}`;
    const fieldXml = fields.map((field) => `<svc:fields>${escapeXml(field)}</svc:fields>`).join("");
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "queryModules",
      `<svc:query>${escapeXml(scopedQuery)}</svc:query>` +
        `<svc:sort>${escapeXml(sort)}</svc:sort>${fieldXml}` +
        `<svc:resultsLimit>${resultsLimit}</svc:resultsLimit>`
    );
    return asArray(unwrapSoapReturn(xml, "queryModulesReturn")).map(normalizeDocument);
  }

  public async queryDocumentsInBaseline(
    projectId: string,
    query: string,
    sort: string,
    baselineRevision: string,
    fields: string[],
    resultsLimit: number
  ): Promise<PolarionDocument[]> {
    await this.authenticate();
    const scopedQuery = query.trim() ? `project.id:${projectId} AND (${query.trim()})` : `project.id:${projectId}`;
    const fieldXml = fields.map((field) => `<svc:fields>${escapeXml(field)}</svc:fields>`).join("");
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "queryModulesInBaseline",
      `<svc:query>${escapeXml(scopedQuery)}</svc:query>` +
        `<svc:sort>${escapeXml(sort)}</svc:sort>` +
        `<svc:baselineRevision>${escapeXml(baselineRevision)}</svc:baselineRevision>` +
        `${fieldXml}<svc:resultsLimit>${resultsLimit}</svc:resultsLimit>`
    );
    return asArray(unwrapSoapReturn(xml, "queryModulesInBaselineReturn")).map(normalizeDocument);
  }

  public async getDocumentWorkItemsInBaseline(
    projectId: string,
    location: string,
    baselineRevision: string,
    documentFields: string[],
    workItemFields: string[],
    maxProjectWorkItems: number
  ): Promise<{ document: PolarionDocument; items: PolarionWorkItem[]; baseline_revision: string; scanned_project_work_items: number }> {
    const documents = await this.queryDocumentsInBaseline(projectId, "", "updated", baselineRevision, documentFields, 500);
    const document = documents.find((candidate) => (candidate.module_location ?? candidate.location) === location);
    if (!document) throw new Error(`Document '${location}' was not found in baseline revision '${baselineRevision}'.`);
    if (!document.uri) throw new Error(`Document '${location}' in baseline '${baselineRevision}' did not return a module URI.`);
    // Polarion's field selector key is "module"; the returned WorkItem property is moduleURI.
    const fields = [...new Set([...workItemFields, "module"])];
    const fieldXml = fields.map((field) => `<svc:fields>${escapeXml(field)}</svc:fields>`).join("");
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "queryWorkItemsInBaselineLimited",
      `<svc:query>${escapeXml(`project.id:${projectId}`)}</svc:query>` +
        `<svc:sort>id</svc:sort><svc:baselineRevision>${escapeXml(baselineRevision)}</svc:baselineRevision>` +
        `${fieldXml}<svc:resultsLimit>${maxProjectWorkItems + 1}</svc:resultsLimit>`
    );
    const projectItems = asArray(unwrapSoapReturn(xml, "queryWorkItemsInBaselineLimitedReturn")).map(normalizeWorkItem);
    if (projectItems.length > maxProjectWorkItems) {
      throw new Error(`Baseline project work-item scan exceeds the ${maxProjectWorkItems}-item safety limit.`);
    }
    const items = projectItems
      .filter((item) => item.module_uri === document.uri)
      .sort((left, right) => (left.outline_number ?? "").localeCompare(right.outline_number ?? "", "en", { numeric: true }));
    return { document, items, baseline_revision: baselineRevision, scanned_project_work_items: projectItems.length };
  }

  public async exportDocumentToPdf(
    documentUri: string,
    properties: {
      paperSize: string;
      orientation: "portrait" | "landscape";
      fitToPageWidth: boolean;
      generateBookmarks: boolean;
      includeHeaderFooter: boolean;
    }
  ): Promise<Buffer> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "exportDocumentToPDF",
      `<svc:uri>${escapeXml(documentUri)}</svc:uri>` +
        `<svc:exportPdfProperties>` +
        `<trk:paperSize>${escapeXml(properties.paperSize)}</trk:paperSize>` +
        `<trk:orientation>${properties.orientation}</trk:orientation>` +
        `<trk:fitToPageWidth>${properties.fitToPageWidth}</trk:fitToPageWidth>` +
        `<trk:generateBookmarks>${properties.generateBookmarks}</trk:generateBookmarks>` +
        `<trk:includeHeaderFooter>${properties.includeHeaderFooter}</trk:includeHeaderFooter>` +
        `</svc:exportPdfProperties>`
    );
    const encoded = stringValue(unwrapSoapReturn(xml, "exportDocumentToPDFReturn"));
    if (!encoded) throw new Error("Polarion PDF export returned no content.");
    return decodeSoapBase64(encoded, "Polarion PDF export");
  }

  public async getAttachmentContent(workItemUri: string, attachmentId: string): Promise<Buffer> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getAttachment",
      `<svc:workitemURI>${escapeXml(workItemUri)}</svc:workitemURI>` +
        `<svc:attachmentId>${escapeXml(attachmentId)}</svc:attachmentId>`
    );
    const encoded = stringValue(unwrapSoapReturn(xml, "getAttachmentReturn"));
    if (!encoded) throw new Error(`Polarion attachment '${attachmentId}' returned no content.`);
    return decodeSoapBase64(encoded, `Polarion attachment '${attachmentId}'`);
  }

  public async queryWorkItems(
    projectId: string,
    query: string,
    sort: string,
    fields: string[],
    resultsLimit: number
  ): Promise<PolarionWorkItem[]> {
    return (await this.queryWorkItemsPage(projectId, query, sort, fields, 0, resultsLimit)).items;
  }

  public async queryWorkItemsPage(
    projectId: string,
    query: string,
    sort: string,
    fields: string[],
    offset: number,
    limit: number
  ): Promise<{ total: number; items: PolarionWorkItem[] }> {
    await this.authenticate();
    const scopedQuery = `project.id:${projectId} AND (${query})`;
    const countXml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getWorkItemsCount",
      `<svc:query>${escapeXml(scopedQuery)}</svc:query>`
    );
    const total = integerValue(unwrapSoapReturn(countXml, "getWorkItemsCountReturn"));
    if (total === undefined) throw new Error("Polarion did not return a valid work-item count.");
    if (offset >= total) return { total, items: [] };
    const fieldXml = fields.map((field) => `<svc:fields>${escapeXml(field)}</svc:fields>`).join("");
    const resultsLimit = offset + limit;
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "queryWorkItemsLimited",
      `<svc:query>${escapeXml(scopedQuery)}</svc:query>` +
        `<svc:sort>${escapeXml(sort)}</svc:sort>${fieldXml}` +
        `<svc:resultsLimit>${resultsLimit}</svc:resultsLimit>`
    );
    const prefix = asArray(unwrapSoapReturn(xml, "queryWorkItemsLimitedReturn")).map(normalizeWorkItem);
    return { total, items: prefix.slice(offset, offset + limit) };
  }

  public async getDocumentWorkItems(
    projectId: string,
    location: string,
    fields: string[]
  ): Promise<{ document: PolarionDocument; items: PolarionWorkItem[] }> {
    const document = await this.getDocument(projectId, location);
    if (!document.uri) {
      throw new Error(`Document '${location}' did not return a module URI.`);
    }
    const fieldXml = fields.map((field) => `<svc:fields>${escapeXml(field)}</svc:fields>`).join("");
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getModuleWorkItems",
      `<svc:moduleURI>${escapeXml(document.uri)}</svc:moduleURI>` +
        `<svc:parentWorkItemURI xsi:nil="true"/>` +
        `<svc:deep>true</svc:deep>${fieldXml}`
    );
    const items = asArray(unwrapSoapReturn(xml, "getModuleWorkItemsReturn")).map(normalizeWorkItem);
    return { document, items };
  }

  public async getWorkItemByUri(uri: string): Promise<PolarionWorkItem> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "getWorkItemByUri",
      `<svc:uri>${escapeXml(uri)}</svc:uri>`
    );
    return normalizeWorkItem(unwrapSoapReturn(xml, "getWorkItemByUriReturn"));
  }

  public async listCustomFieldDefinitions(projectId: string, typeId: string): Promise<PolarionCustomFieldDefinition[]> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "getDefinedCustomFieldTypes",
      `<svc:projectID>${escapeXml(projectId)}</svc:projectID><svc:typeID>${escapeXml(typeId)}</svc:typeID>`
    );
    return asArray(unwrapSoapReturn(xml, "getDefinedCustomFieldTypesReturn"))
      .map(normalizeCustomFieldDefinition)
      .filter((field): field is PolarionCustomFieldDefinition => field !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id, "en"));
  }

  public async getCustomField(workItemUri: string, key: string): Promise<PolarionCustomField> {
    await this.authenticate();
    const xml = await this.request(
      "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "getCustomField",
      `<svc:workitemURI>${escapeXml(workItemUri)}</svc:workitemURI><svc:key>${escapeXml(key)}</svc:key>`
    );
    const value = unwrapSoapReturn(xml, "getCustomFieldReturn");
    if (!isRecord(value)) return { key, value: undefined };
    return { key: stringValue(value.key) ?? key, value: normalizeCustomFieldValue(value.value) };
  }

  public async setWorkItemCustomFields(input: {
    projectId: string;
    workItemId: string;
    fields: PolarionCustomFieldInput[];
    expectedUpdated?: string | undefined;
  }): Promise<CustomFieldMutationResult> {
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    if (!item.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    if (input.expectedUpdated !== undefined && item.updated !== input.expectedUpdated) {
      throw new Error(`Work item '${input.workItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${item.updated ?? "unknown"}).`);
    }
    if (new Set(input.fields.map((field) => field.key)).size !== input.fields.length) throw new Error("Custom field keys must be unique.");
    const definitions = await this.listCustomFieldDefinitions(input.projectId, item.type ?? "");
    const configured = new Map(definitions.map((definition) => [definition.id, definition]));
    for (const field of input.fields) {
      const definition = configured.get(field.key);
      if (!definition) throw new Error(`Custom field '${field.key}' is not defined for work-item type '${item.type ?? "unknown"}'.`);
      if (!customFieldTypeIsCompatible(definition, field.value_type)) {
        throw new Error(`Custom field '${field.key}' has Polarion type '${definition.type ?? "unknown"}', which is incompatible with requested value_type '${field.value_type}'.`);
      }
      customFieldValueXml(field);
    }
    for (const field of input.fields) {
      await this.request(
        "TrackerWebService", TRACKER_SERVICE_NAMESPACE, "setCustomField",
        `<svc:customField><trk:key>${escapeXml(field.key)}</trk:key><trk:parentItemURI>${escapeXml(item.uri)}</trk:parentItemURI>${customFieldValueXml(field)}</svc:customField>`
      );
    }
    const fields = [];
    for (const field of input.fields) {
      const readback = await this.getCustomField(item.uri, field.key);
      const verified = JSON.stringify(readback.value) === JSON.stringify(expectedCustomFieldValue(field));
      fields.push({ key: field.key, verified, actual: readback.value });
    }
    return {
      operation: "set_custom_fields",
      project_id: input.projectId,
      work_item_id: input.workItemId,
      executed: true,
      verified: fields.every((field) => field.verified),
      fields
    };
  }

  private workItemContentXml(input: {
    projectId?: string | undefined;
    projectUri?: string | undefined;
    uri?: string | undefined;
    title?: string | undefined;
    description?: string | undefined;
    type?: string | undefined;
    status?: string | undefined;
  }): string {
    const attributes = input.uri ? ` uri="${escapeXml(input.uri)}"` : "";
    const fields: string[] = [];
    if (input.description !== undefined) {
      fields.push(
        `<trk:description><typ:type>text/html</typ:type><typ:content>${escapeXml(input.description)}</typ:content><typ:contentLossy>false</typ:contentLossy></trk:description>`
      );
    }
    if (input.projectId && input.projectUri) {
      fields.push(
        `<trk:project uri="${escapeXml(input.projectUri)}"><prj:id>${escapeXml(input.projectId)}</prj:id></trk:project>`
      );
    }
    if (input.status !== undefined) {
      fields.push(`<trk:status><trk:id>${escapeXml(input.status)}</trk:id></trk:status>`);
    }
    if (input.title !== undefined) fields.push(`<trk:title>${escapeXml(input.title)}</trk:title>`);
    if (input.type !== undefined) {
      fields.push(`<trk:type><trk:id>${escapeXml(input.type)}</trk:id></trk:type>`);
    }
    return `<svc:content${attributes}>${fields.join("")}</svc:content>`;
  }

  public async createWorkItem(input: {
    projectId: string;
    title: string;
    description?: string | undefined;
    type: string;
    documentLocation?: string | undefined;
  }): Promise<WorkItemMutationResult> {
    await this.authenticate();
    const project = await this.getProjectReference(input.projectId);
    let operation = "createWorkItem";
    let returnTag = "createWorkItemReturn";
    let body = this.workItemContentXml({ ...input, projectUri: project.uri });
    if (input.documentLocation) {
      const document = await this.getDocument(input.projectId, input.documentLocation);
      if (!document.uri) throw new Error(`Document '${input.documentLocation}' did not return a module URI.`);
      operation = "createWorkItemInModule";
      returnTag = "createWorkItemInModuleReturn";
      const content = this.workItemContentXml({ ...input, projectUri: project.uri })
        .replace(/^<svc:content/, "<svc:workItem")
        .replace(/<\/svc:content>$/, "</svc:workItem>");
      body = `<svc:moduleURI>${escapeXml(document.uri)}</svc:moduleURI><svc:parentWorkItemURI xsi:nil="true"/>${content}`;
    }
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      operation,
      body
    );
    const uri = stringValue(unwrapSoapReturn(xml, returnTag));
    if (!uri) throw new Error("Polarion created the work item but did not return its URI.");
    let item: PolarionWorkItem | undefined;
    const verificationErrors: string[] = [];
    try {
      item = await this.getWorkItemByUri(uri);
    } catch {
      item = undefined;
      verificationErrors.push("created work item could not be read back");
    }
    if (item) {
      if (!item.id) verificationErrors.push("created work item readback has no ID");
      for (const field of ["title", "description", "type"] as const) {
        if (input[field] !== undefined && item[field] !== input[field]) {
          verificationErrors.push(`${field} readback mismatch`);
        }
      }
    }
    return {
      operation: "create",
      project_id: input.projectId,
      work_item_id: item?.id,
      work_item_uri: uri,
      document_location: input.documentLocation,
      executed: true,
      verified: verificationErrors.length === 0,
      verification_errors: verificationErrors.length > 0 ? verificationErrors : undefined,
      item
    };
  }

  public async getProjectReference(projectId: string): Promise<{ id: string; uri: string }> {
    await this.authenticate();
    const xml = await this.request(
      "ProjectWebService",
      PROJECT_SERVICE_NAMESPACE,
      "getProject",
      `<svc:projectID>${escapeXml(projectId)}</svc:projectID>`
    );
    const value = unwrapSoapReturn(xml, "getProjectReturn");
    if (!isRecord(value)) throw new Error(`Project '${projectId}' did not return project metadata.`);
    const id = stringValue(value.id) ?? projectId;
    const uri = stringValue(value["@_uri"] ?? value.uri);
    if (!uri) throw new Error(`Project '${projectId}' did not return a project URI.`);
    return { id, uri };
  }

  public async updateWorkItem(input: {
    projectId: string;
    workItemId: string;
    title?: string | undefined;
    description?: string | undefined;
    type?: string | undefined;
    status?: string | undefined;
    expectedUpdated?: string | undefined;
  }): Promise<WorkItemMutationResult> {
    const current = await this.getWorkItem(input.projectId, input.workItemId);
    if (!current.uri) throw new Error(`Work item '${input.workItemId}' did not return a URI.`);
    if (input.expectedUpdated !== undefined && current.updated !== input.expectedUpdated) {
      throw new Error(
        `Work item '${input.workItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${current.updated ?? "unknown"}).`
      );
    }
    const body = this.workItemContentXml({
      uri: current.uri,
      title: input.title,
      description: input.description,
      type: input.type,
      status: input.status
    });
    await this.request("TrackerWebService", TRACKER_SERVICE_NAMESPACE, "updateWorkItem", body);
    const item = await this.getWorkItem(input.projectId, input.workItemId);
    const verificationErrors: string[] = [];
    for (const field of ["title", "description", "type", "status"] as const) {
      if (input[field] !== undefined && item[field] !== input[field]) {
        verificationErrors.push(`${field} readback mismatch`);
      }
    }
    return {
      operation: "update",
      project_id: input.projectId,
      work_item_id: input.workItemId,
      work_item_uri: current.uri,
      executed: true,
      verified: verificationErrors.length === 0,
      verification_errors: verificationErrors.length > 0 ? verificationErrors : undefined,
      item
    };
  }

  public async deleteWorkItem(
    projectId: string,
    workItemId: string,
    expectedUpdated?: string
  ): Promise<WorkItemMutationResult> {
    const current = await this.getWorkItem(projectId, workItemId);
    if (!current.uri) throw new Error(`Work item '${workItemId}' did not return a URI.`);
    if (expectedUpdated !== undefined && current.updated !== expectedUpdated) {
      throw new Error(
        `Work item '${workItemId}' changed since it was read (expected updated=${expectedUpdated}, actual=${current.updated ?? "unknown"}).`
      );
    }
    await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      "deleteWorkItem",
      `<svc:workitemURI>${escapeXml(current.uri)}</svc:workitemURI>`
    );
    let verified = false;
    try {
      const tombstone = await this.getWorkItem(projectId, workItemId);
      verified = tombstone.unresolvable === true || tombstone.id !== workItemId;
    } catch {
      verified = true;
    }
    return {
      operation: "delete",
      project_id: projectId,
      work_item_id: workItemId,
      work_item_uri: current.uri,
      executed: true,
      verified
    };
  }

  private async mutateWorkItemLink(input: {
    operation: "link" | "unlink";
    projectId: string;
    sourceWorkItemId: string;
    targetWorkItemId: string;
    role: string;
    expectedUpdated?: string | undefined;
  }): Promise<WorkItemLinkMutationResult> {
    const source = await this.getWorkItem(input.projectId, input.sourceWorkItemId);
    const target = await this.getWorkItem(input.projectId, input.targetWorkItemId);
    if (!source.uri) throw new Error(`Source work item '${input.sourceWorkItemId}' did not return a URI.`);
    if (!target.uri) throw new Error(`Target work item '${input.targetWorkItemId}' did not return a URI.`);
    if (input.expectedUpdated !== undefined && source.updated !== input.expectedUpdated) {
      throw new Error(
        `Work item '${input.sourceWorkItemId}' changed since it was read (expected updated=${input.expectedUpdated}, actual=${source.updated ?? "unknown"}).`
      );
    }

    const adding = input.operation === "link";
    const operation = adding ? "addLinkedItem" : "removeLinkedItem";
    const returnTag = adding ? "addLinkedItemReturn" : "removeLinkedItemReturn";
    const targetElement = adding ? "linkedWorkitemURI" : "linkedItemURI";
    const xml = await this.request(
      "TrackerWebService",
      TRACKER_SERVICE_NAMESPACE,
      operation,
      `<svc:workitemURI>${escapeXml(source.uri)}</svc:workitemURI>` +
        `<svc:${targetElement}>${escapeXml(target.uri)}</svc:${targetElement}>` +
        `<svc:role><trk:id>${escapeXml(input.role)}</trk:id></svc:role>`
    );
    const serverReturned = booleanValue(unwrapSoapReturn(xml, returnTag));
    const backLinks = await this.getBackLinkedWorkItems(target.uri);
    const present = backLinks.some(
      (link) => link.work_item_uri === source.uri && link.role === input.role
    );
    return {
      operation: input.operation,
      project_id: input.projectId,
      source_work_item_id: input.sourceWorkItemId,
      target_work_item_id: input.targetWorkItemId,
      role: input.role,
      executed: true,
      verified: adding ? present : !present,
      server_returned: serverReturned,
      source_item: source
    };
  }

  public async addWorkItemLink(input: {
    projectId: string;
    sourceWorkItemId: string;
    targetWorkItemId: string;
    role: string;
    expectedUpdated?: string | undefined;
  }): Promise<WorkItemLinkMutationResult> {
    return this.mutateWorkItemLink({ operation: "link", ...input });
  }

  public async removeWorkItemLink(input: {
    projectId: string;
    sourceWorkItemId: string;
    targetWorkItemId: string;
    role: string;
    expectedUpdated?: string | undefined;
  }): Promise<WorkItemLinkMutationResult> {
    return this.mutateWorkItemLink({ operation: "unlink", ...input });
  }
}
