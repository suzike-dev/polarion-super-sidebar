export type ResponseFormat = "json" | "markdown";

export interface PolarionConfig {
  baseUrl: string;
  projectId: string;
  defaultDocumentLocation: string;
  authMode: "password" | "access_token";
  username?: string | undefined;
  password?: string | undefined;
  accessToken?: string | undefined;
  timeoutMs: number;
  exportRoot?: string | undefined;
  writeEnabled?: boolean | undefined;
  writeProjectIds?: string[] | undefined;
  writeDocumentLocations?: string[] | undefined;
}

export interface PolarionProjectGroup {
  name?: string | undefined;
  location?: string | undefined;
  parent_uri?: string | undefined;
  group_uris: string[];
  project_ids: string[];
  uri?: string | undefined;
  unresolvable?: boolean | undefined;
}

export interface PolarionProject {
  id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  active?: boolean | undefined;
  location?: string | undefined;
  project_group_uri?: string | undefined;
  tracker_prefix?: string | undefined;
  start?: string | undefined;
  finish?: string | undefined;
  lead?: PolarionUserSummary | undefined;
  uri?: string | undefined;
  unresolvable?: boolean | undefined;
}

export interface PolarionExportArtifact {
  path: string;
  file_name: string;
  bytes: number;
  sha256: string;
  reused: boolean;
  source_uri?: string | undefined;
}

export interface ConnectionStatus {
  server: string;
  project_id: string;
  wsdl_reachable: boolean;
  wsdl_status: number;
  authentication_mode: "password" | "access_token";
  credentials_configured: boolean;
  authenticated: boolean;
  writes_enabled: boolean;
  write_project_allowlist: string[];
  write_document_allowlist: string[];
  message: string;
}

export interface PolarionLink {
  role?: string | undefined;
  work_item_uri?: string | undefined;
  revision?: string | undefined;
  suspect?: boolean | undefined;
}

export interface PolarionEnumOption {
  id?: string | undefined;
  name?: string | undefined;
  hidden?: boolean | undefined;
  default?: boolean | undefined;
  sequence_number?: number | undefined;
}

export interface PolarionCustomField {
  key: string;
  value: unknown;
}

export interface PolarionCustomFieldDefinition {
  id: string;
  name?: string | undefined;
  description?: string | undefined;
  type?: string | undefined;
  multi: boolean;
  required: boolean;
  depends_on?: string | undefined;
  default_value?: unknown;
}

export interface PolarionCustomFieldInput {
  key: string;
  value_type: "string" | "text" | "boolean" | "integer" | "enum" | "date";
  value: string | boolean | number;
}

export interface CustomFieldMutationResult {
  operation: "set_custom_fields";
  project_id: string;
  work_item_id: string;
  executed: boolean;
  verified: boolean;
  fields: Array<{ key: string; verified: boolean; actual?: unknown }>;
}

export interface PolarionUserSummary {
  id?: string | undefined;
  name?: string | undefined;
  uri?: string | undefined;
}

export interface PolarionComment {
  id?: string | undefined;
  title?: string | undefined;
  text?: string | undefined;
  text_type?: string | undefined;
  created?: string | undefined;
  resolved?: boolean | undefined;
  author?: PolarionUserSummary | undefined;
  parent_comment_uri?: string | undefined;
  child_comment_uris: string[];
  tags: string[];
  uri?: string | undefined;
}

export interface PolarionApproval {
  status?: string | undefined;
  user?: PolarionUserSummary | undefined;
}

export interface PolarionAttachment {
  id?: string | undefined;
  title?: string | undefined;
  file_name?: string | undefined;
  length?: number | undefined;
  updated?: string | undefined;
  author?: PolarionUserSummary | undefined;
  uri?: string | undefined;
}

export interface PolarionHyperlink {
  role?: string | undefined;
  uri?: string | undefined;
}

export interface PolarionHistoryChange {
  revision?: string | undefined;
  date?: string | undefined;
  user?: PolarionUserSummary | undefined;
  creation?: boolean | undefined;
  empty?: boolean | undefined;
  invalid?: boolean | undefined;
  diffs: Array<{
    field_name?: string | undefined;
    before?: unknown | undefined;
    after?: unknown | undefined;
    added?: unknown | undefined;
    removed?: unknown | undefined;
    collection?: boolean | undefined;
  }>;
}

export interface PolarionBaseline {
  id?: string | undefined;
  name?: string | undefined;
  description?: string | undefined;
  base_revision?: string | undefined;
  base_object_uri?: string | undefined;
  project_id?: string | undefined;
  author?: PolarionUserSummary | undefined;
  uri?: string | undefined;
  unresolvable?: boolean | undefined;
}

export interface PolarionWorkflowAction {
  action_id?: number | undefined;
  action_name?: string | undefined;
  native_action_id?: string | undefined;
  target_status?: string | undefined;
  required_features: string[];
  suggested_features: string[];
  cleaned_features: string[];
  unavailability_message?: string | undefined;
}

export interface WorkItemWorkflowActions {
  project_id: string;
  work_item_id: string;
  current_status?: string | undefined;
  updated?: string | undefined;
  available: PolarionWorkflowAction[];
  unavailable: PolarionWorkflowAction[];
}

export interface WorkflowActionMutationResult {
  operation: "perform_workflow_action";
  project_id: string;
  work_item_id: string;
  action_id: number;
  action_name?: string | undefined;
  native_action_id?: string | undefined;
  previous_status?: string | undefined;
  target_status?: string | undefined;
  actual_status?: string | undefined;
  executed: boolean;
  verified: boolean;
  item?: PolarionWorkItem | undefined;
}

export interface CommentMutationResult {
  operation: "add_comment" | "set_comment_resolved";
  project_id: string;
  work_item_id: string;
  comment_id?: string | undefined;
  comment_uri?: string | undefined;
  resolved?: boolean | undefined;
  executed: boolean;
  verified: boolean;
  comment?: PolarionComment | undefined;
}

export interface PolarionWorkItem {
  id?: string | undefined;
  title?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  previous_status?: string | undefined;
  priority?: string | undefined;
  severity?: string | undefined;
  resolution?: string | undefined;
  description?: string | undefined;
  description_type?: string | undefined;
  outline_number?: string | undefined;
  module_uri?: string | undefined;
  location?: string | undefined;
  uri?: string | undefined;
  created?: string | undefined;
  updated?: string | undefined;
  due_date?: string | undefined;
  author?: PolarionUserSummary | undefined;
  assignees: PolarionUserSummary[];
  comments: PolarionComment[];
  approvals: PolarionApproval[];
  attachments: PolarionAttachment[];
  hyperlinks: PolarionHyperlink[];
  unresolvable?: boolean | undefined;
  linked_work_items: PolarionLink[];
  custom_fields: PolarionCustomField[];
}

export interface PolarionDocument {
  id?: string | undefined;
  title?: string | undefined;
  type?: string | undefined;
  status?: string | undefined;
  location?: string | undefined;
  module_location?: string | undefined;
  module_name?: string | undefined;
  module_folder?: string | undefined;
  uri?: string | undefined;
  project_id?: string | undefined;
  created?: string | undefined;
  updated?: string | undefined;
  author?: PolarionUserSummary | undefined;
  updated_by?: PolarionUserSummary | undefined;
  home_page_content?: string | undefined;
  home_page_content_type?: string | undefined;
}

export interface PaginatedWorkItems {
  project_id: string;
  query?: string | undefined;
  document_location?: string | undefined;
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number | undefined;
  items: PolarionWorkItem[];
}

export interface WorkItemMutationResult {
  operation: "create" | "update" | "delete";
  project_id: string;
  work_item_id?: string | undefined;
  work_item_uri?: string | undefined;
  document_location?: string | undefined;
  executed: boolean;
  verified: boolean;
  verification_errors?: string[] | undefined;
  item?: PolarionWorkItem | undefined;
}

export interface WorkItemLinkMutationResult {
  operation: "link" | "unlink";
  project_id: string;
  source_work_item_id: string;
  target_work_item_id: string;
  role: string;
  executed: boolean;
  verified: boolean;
  server_returned?: boolean | undefined;
  source_item?: PolarionWorkItem | undefined;
}
