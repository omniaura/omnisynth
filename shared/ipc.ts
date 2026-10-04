/**
 * Types shared between the Electron main process, the preload bridge and the
 * renderer. Everything the renderer can ask the desktop shell to do is listed
 * here so both sides type-check against one contract.
 */

export type ProviderId = "ditto" | "openrouter" | "ollama" | "claude-code" | "codex" | "opencode" | "custom";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** OpenAI-compatible base URL ending in /v1 (or Ollama's /v1 shim). */
  baseUrl: string;
  /** Whether a usable credential is present (env, config file, or stored key). */
  authenticated: boolean;
  /** Where the credential came from, for display. */
  source?: string;
  /** Default model to use when the user has not picked one. */
  defaultModel?: string;
  /** Short explanation when the provider was detected but is unusable. */
  note?: string;
}

export interface ChatMessageContentText {
  type: "text";
  text: string;
}
export interface ChatMessageContentImage {
  type: "image_url";
  image_url: { url: string; detail?: "low" | "high" | "auto" };
}
export interface ChatMessageContentAudio {
  type: "input_audio";
  input_audio: { data: string; format: "wav" | "mp3" };
}
export type ChatMessageContent = ChatMessageContentText | ChatMessageContentImage | ChatMessageContentAudio;

export interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ChatMessageContent[] | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  tool_choice?: "auto" | "required" | "none";
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" } | { type: "json_schema"; json_schema: Record<string, unknown> };
  /** Correlates a cancel request with the in-flight call. */
  requestId?: string;
}

export interface ChatResponse {
  id?: string;
  model?: string;
  message: ChatMessage;
  finish_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface ModelInfo {
  id: string;
  name?: string;
  inputModalities?: string[];
}

export interface Attachment {
  id: string;
  kind: "image" | "audio" | "text";
  name: string;
  mime: string;
  /** base64 payload (no data: prefix). Text attachments carry UTF-8 text here instead. */
  data: string;
  size: number;
  path?: string;
}

export interface DittoDeviceCode {
  user_code: string;
  verification_url: string;
}

export interface DittoLoginResult {
  ok: boolean;
  error?: string;
}

export interface DittoEndpoint {
  id: string;
  slug: string;
  name: string;
  model: string;
}

export interface DittoStatus {
  loggedIn: boolean;
  source?: "app" | "cli" | "env";
  cliInstalled: boolean;
  /** The endpoint powering OmniSynth, if one has been created/selected. */
  endpoint?: DittoEndpoint;
  hasEndpointKey: boolean;
}

export interface OmniSynthBridge {
  platform: NodeJS.Platform;
  version: string;
  providers: {
    detect(): Promise<ProviderInfo[]>;
    setKey(provider: ProviderId, key: string): Promise<void>;
    clearKey(provider: ProviderId): Promise<void>;
    setCustom(baseUrl: string, model: string): Promise<void>;
  };
  inference: {
    chat(req: ChatRequest): Promise<ChatResponse>;
    cancel(requestId: string): Promise<void>;
    models(provider: ProviderId): Promise<ModelInfo[]>;
  };
  ditto: {
    status(): Promise<DittoStatus>;
    /** Starts the browser device flow; resolves when approved or failed. */
    login(onCode: (code: DittoDeviceCode) => void): Promise<DittoLoginResult>;
    logout(): Promise<void>;
    listEndpoints(): Promise<DittoEndpoint[]>;
    /** Creates (or reuses) an OmniSynth endpoint and mints a key for it. */
    createEndpoint(model?: string): Promise<DittoEndpoint>;
    useEndpoint(id: string): Promise<DittoEndpoint>;
  };
  files: {
    pick(kinds: Array<"image" | "audio" | "text">): Promise<Attachment[]>;
    readPaths(paths: string[]): Promise<Attachment[]>;
    saveJson(suggestedName: string, json: string): Promise<string | null>;
    openJson(): Promise<string | null>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
}

export const IPC = {
  providersDetect: "providers:detect",
  providersSetKey: "providers:setKey",
  providersClearKey: "providers:clearKey",
  providersSetCustom: "providers:setCustom",
  inferenceChat: "inference:chat",
  inferenceCancel: "inference:cancel",
  inferenceModels: "inference:models",
  dittoStatus: "ditto:status",
  dittoLogin: "ditto:login",
  dittoLoginCode: "ditto:loginCode",
  dittoLogout: "ditto:logout",
  dittoListEndpoints: "ditto:listEndpoints",
  dittoCreateEndpoint: "ditto:createEndpoint",
  dittoUseEndpoint: "ditto:useEndpoint",
  filesPick: "files:pick",
  filesReadPaths: "files:readPaths",
  filesSaveJson: "files:saveJson",
  filesOpenJson: "files:openJson",
  shellOpenExternal: "shell:openExternal",
} as const;
