/**
 * OpenAPI 文档拉取（后端 Swagger 在根路径 /docs-json，不经 /static 前缀）
 * 不使用统一请求客户端：文档为公开 JSON，且不需要信封解包。
 */

export interface OpenApiParameter {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie' | 'body';
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
  example?: unknown;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: OpenApiSchema;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  description?: string;
  example?: unknown;
  default?: unknown;
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  additionalProperties?: OpenApiSchema | boolean;
}

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: Record<
    string,
    {
      description?: string;
      content?: Record<string, { schema?: OpenApiSchema }>;
    }
  >;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
  tags?: { name: string; description?: string }[];
}

function docsBaseUrl() {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase && envBase !== 'origin') {
    return envBase.replace(/\/$/, '');
  }
  return '';
}

export async function fetchOpenApiDocument() {
  const res = await fetch(`${docsBaseUrl()}/docs-json`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? '未找到 /docs-json：后端 ENABLE_SWAGGER 可能已关闭'
        : `获取 OpenAPI 文档失败（HTTP ${res.status}）`,
    );
  }
  return (await res.json()) as OpenApiDocument;
}

/** 解析 $ref（仅支持 #/components/schemas/...） */
export function resolveSchema(
  schema: OpenApiSchema | undefined,
  doc: OpenApiDocument,
  depth = 0,
): OpenApiSchema | undefined {
  if (!schema || depth > 6) return schema;
  if (schema.$ref?.startsWith('#/components/schemas/')) {
    const name = schema.$ref.slice('#/components/schemas/'.length);
    const target = doc.components?.schemas?.[name];
    return target ? resolveSchema(target, doc, depth + 1) : schema;
  }
  return schema;
}

/** 生成示例值（用于响应示例展示，结构化到 3 层） */
export function schemaExample(
  schema: OpenApiSchema | undefined,
  doc: OpenApiDocument,
  depth = 0,
): unknown {
  const resolved = resolveSchema(schema, doc, depth);
  if (!resolved) return null;
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.enum?.length) return resolved.enum[0];
  const type = resolved.type ?? (resolved.properties ? 'object' : undefined);
  if (type === 'object' || resolved.properties) {
    if (depth >= 3) return '{…}';
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(resolved.properties ?? {})) {
      out[key] = schemaExample(value, doc, depth + 1);
    }
    return out;
  }
  if (type === 'array') {
    return [schemaExample(resolved.items, doc, depth + 1)];
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return true;
  if (type === 'string') {
    if (resolved.format === 'date-time') return '2026-01-01T00:00:00.000Z';
    return 'string';
  }
  return null;
}
