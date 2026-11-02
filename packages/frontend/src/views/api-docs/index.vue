<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { NButton, NIcon, NInput, NSpin, NTag } from 'naive-ui';
import {
  CodeSlashOutline,
  DocumentTextOutline,
  KeyOutline,
  LockClosedOutline,
  RefreshOutline,
  SearchOutline,
} from '@vicons/ionicons5';
import type {
  OpenApiDocument,
  OpenApiOperation,
  OpenApiSchema,
} from '@/api/docs';
import { fetchOpenApiDocument, resolveSchema, schemaExample } from '@/api/docs';
import { highlightCode } from '@/utils/hljs';
import PageHeader from '@/components/common/page-header.vue';
import EmptyState from '@/components/common/empty-state.vue';
import ErrorState from '@/components/common/error-state.vue';
import 'highlight.js/styles/atom-one-dark.css';

/**
 * API 文档（自建 OpenAPI 渲染）
 *
 * - 数据源：后端根路径 /docs-json（不经 /static 前缀）
 * - 按 tag 分组、支持搜索；参数表、请求体、响应示例
 * - 代码用 highlight.js 高亮，禁止 iframe 嵌 Swagger
 */

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface DocOperation {
  key: string;
  method: HttpMethod;
  path: string;
  summary: string;
  description: string;
  tags: string[];
  operation: OpenApiOperation;
}

const doc = ref<OpenApiDocument | null>(null);
const loading = ref(false);
const error = ref('');
const search = ref('');
const selectedKey = ref('');

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

const operations = computed<DocOperation[]>(() => {
  const paths = doc.value?.paths ?? {};
  const list: DocOperation[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      list.push({
        key: `${method}:${path}`,
        method,
        path,
        summary: operation.summary ?? `${method.toUpperCase()} ${path}`,
        description: operation.description ?? '',
        tags: operation.tags?.length ? operation.tags : ['其他'],
        operation,
      });
    }
  }
  return list;
});

const tagDescriptions = computed(() => {
  const map = new Map<string, string>();
  for (const tag of doc.value?.tags ?? []) {
    if (tag.description) map.set(tag.name, tag.description);
  }
  return map;
});

const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return operations.value;
  return operations.value.filter((op) =>
    [op.path, op.method, op.summary, op.description, ...op.tags]
      .join(' ')
      .toLowerCase()
      .includes(keyword),
  );
});

const grouped = computed(() => {
  const order: string[] = [];
  const groups = new Map<string, DocOperation[]>();
  for (const op of filtered.value) {
    const tag = op.tags[0];
    if (!groups.has(tag)) {
      groups.set(tag, []);
      order.push(tag);
    }
    groups.get(tag)!.push(op);
  }
  return order.map((tag) => ({
    tag,
    description: tagDescriptions.value.get(tag),
    operations: groups.get(tag)!,
  }));
});

watch(
  filtered,
  (list) => {
    if (!list.some((op) => op.key === selectedKey.value)) {
      selectedKey.value = list[0]?.key ?? '';
    }
  },
  { immediate: true },
);

const current = computed(
  () => operations.value.find((op) => op.key === selectedKey.value) ?? null,
);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    doc.value = await fetchOpenApiDocument();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '获取 OpenAPI 文档失败';
    doc.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(() => void load());

// ===================== 渲染辅助 =====================

function methodType(method: HttpMethod) {
  if (method === 'get') return 'success' as const;
  if (method === 'post') return 'info' as const;
  if (method === 'delete') return 'error' as const;
  return 'warning' as const;
}

function typeLabel(schema: OpenApiSchema | undefined): string {
  if (!schema) return '—';
  if (schema.$ref) return schema.$ref.split('/').pop() ?? schema.$ref;
  if (schema.type === 'array') {
    return `array<${typeLabel(schema.items)}>`;
  }
  if (schema.enum?.length) {
    return `${schema.type ?? 'enum'}（${schema.enum.join(' | ')}）`;
  }
  return schema.format
    ? `${schema.type ?? 'unknown'}(${schema.format})`
    : (schema.type ?? 'object');
}

interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

function schemaFields(schema: OpenApiSchema | undefined): FieldRow[] {
  const resolved = resolveSchema(schema, doc.value ?? {}, 0);
  if (!resolved?.properties) return [];
  const required = new Set(resolved.required ?? []);
  return Object.entries(resolved.properties).map(([name, value]) => ({
    name,
    type: typeLabel(resolveSchema(value, doc.value ?? {}, 0)),
    required: required.has(name),
    description: resolveSchema(value, doc.value ?? {}, 0)?.description ?? '',
  }));
}

function queryRows(op: OpenApiOperation) {
  return (op.parameters ?? []).map((param) => ({
    name: param.name,
    in: param.in,
    required: Boolean(param.required),
    type: typeLabel(param.schema),
    description: param.description ?? '',
  }));
}

interface BodyContent {
  contentType: string;
  fields: FieldRow[];
  exampleHtml: string;
}

function bodyContents(op: OpenApiOperation): BodyContent[] {
  const content = op.requestBody?.content;
  if (!content) return [];
  return Object.entries(content).map(([contentType, media]) => {
    const example = media.schema
      ? schemaExample(media.schema, doc.value ?? {})
      : null;
    return {
      contentType,
      fields: schemaFields(media.schema),
      exampleHtml: example
        ? highlightCode(JSON.stringify(example, null, 2), 'example.json')
        : '',
    };
  });
}

interface ResponseEntry {
  status: string;
  description: string;
  codeHtml: string;
  contentType?: string;
}

function responseEntries(op: OpenApiOperation): ResponseEntry[] {
  return Object.entries(op.responses ?? {}).map(([status, response]) => {
    const content = response.content ?? {};
    const media = content['application/json'] ?? Object.values(content)[0];
    const example = media?.schema
      ? schemaExample(media.schema, doc.value ?? {})
      : null;
    return {
      status,
      description: response.description ?? '',
      contentType: Object.keys(content)[0],
      codeHtml: example
        ? highlightCode(JSON.stringify(example, null, 2), 'example.json')
        : '',
    };
  });
}

function statusType(status: string) {
  const first = status[0];
  if (first === '2') return 'success' as const;
  if (first === '4') return 'warning' as const;
  if (first === '5') return 'error' as const;
  return 'info' as const;
}

function copy(text: string) {
  void navigator.clipboard.writeText(text);
}
</script>

<template>
  <div class="flex flex-col gap-4 animate-fade-up">
    <PageHeader
      title="API 文档"
      description="从后端 /docs-json 拉取 OpenAPI 自建渲染，按标签分组、支持搜索与响应示例"
      :icon="CodeSlashOutline"
    >
      <template #actions>
        <NButton size="small" quaternary :loading="loading" @click="load">
          <template #icon
            ><NIcon><RefreshOutline /></NIcon
          ></template>
          刷新文档
        </NButton>
      </template>
    </PageHeader>

    <!-- 鉴权说明 -->
    <section class="glass-panel px-4 py-3 flex items-start gap-3">
      <div class="glass-chip w-9 h-9 flex items-center justify-center shrink-0">
        <NIcon :size="18" class="text-brand-600 dark:text-brand-400"
          ><KeyOutline
        /></NIcon>
      </div>
      <div class="min-w-0">
        <p class="m-0 text-12px font-600 text-ink">鉴权说明（Bearer Token）</p>
        <p class="m-0 mt-1 text-11px text-ink-sub leading-5">
          除标记为「公开」的接口外，均需在请求头携带
          <code class="font-mono"
            >Authorization: Bearer &lt;accessToken&gt;</code
          >。 令牌通过
          <code class="font-mono">POST /static/auth/login</code> 获取，
          有效期见登录接口响应。公开接口（分享访问、认证登录、占位图等）无需令牌。
        </p>
      </div>
    </section>

    <NSpin :show="loading">
      <ErrorState v-if="error" :message="error" @retry="load" />

      <EmptyState
        v-else-if="!loading && operations.length === 0"
        :icon="DocumentTextOutline"
        title="没有可展示的接口"
        description="后端 /docs-json 返回了空文档，或 Swagger 未启用。可检查后端 ENABLE_SWAGGER 配置。"
      >
        <NButton size="small" @click="load">重新拉取</NButton>
      </EmptyState>

      <div v-else class="flex flex-col gap-3">
        <section
          class="glass-panel px-4 py-3 flex items-center gap-3 flex-wrap"
        >
          <NInput
            v-model:value="search"
            size="small"
            clearable
            placeholder="搜索接口路径 / 名称 / 标签"
            class="w-72"
          >
            <template #prefix
              ><NIcon :size="14"><SearchOutline /></NIcon
            ></template>
          </NInput>
          <span class="text-11px text-ink-sub">
            {{ doc?.info?.title ?? 'OpenAPI' }}
            <template v-if="doc?.info?.version"
              >· v{{ doc.info.version }}</template
            >
          </span>
          <span class="ml-auto text-11px text-ink-sub">
            共 {{ operations.length }} 个接口 · 当前 {{ filtered.length }} 个
          </span>
        </section>

        <div class="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] items-start">
          <!-- 接口目录 -->
          <aside
            class="glass-panel px-3 py-3 flex flex-col gap-3 xl:sticky xl:top-2 max-h-70vh overflow-y-auto"
          >
            <div
              v-for="group in grouped"
              :key="group.tag"
              class="flex flex-col gap-1"
            >
              <div class="flex items-center gap-2 px-1">
                <p class="m-0 text-11px font-600 text-ink">{{ group.tag }}</p>
                <span class="text-10px text-ink-sub">{{
                  group.operations.length
                }}</span>
              </div>
              <p
                v-if="group.description"
                class="m-0 px-1 text-10px text-ink-sub leading-4"
              >
                {{ group.description }}
              </p>
              <button
                v-for="op in group.operations"
                :key="op.key"
                type="button"
                class="w-full text-left px-2 py-1.5 rounded-lg border-0 bg-transparent transition-colors flex items-center gap-2 min-w-0 cursor-pointer"
                :class="
                  op.key === selectedKey
                    ? 'bg-brand-500/12 text-brand-700 dark:text-brand-300'
                    : 'text-ink-sub hover:bg-brand-500/6'
                "
                @click="selectedKey = op.key"
              >
                <NTag
                  size="tiny"
                  :bordered="false"
                  :type="methodType(op.method)"
                  class="shrink-0"
                >
                  {{ op.method.toUpperCase() }}
                </NTag>
                <span class="text-11px font-mono truncate" :title="op.path">{{
                  op.path
                }}</span>
              </button>
            </div>

            <p
              v-if="grouped.length === 0"
              class="m-0 px-2 py-4 text-center text-11px text-ink-sub"
            >
              没有匹配的接口
            </p>
          </aside>

          <!-- 接口详情 -->
          <section
            v-if="current"
            class="glass-panel px-5 py-4 flex flex-col gap-4 min-w-0"
          >
            <div class="flex flex-col gap-2">
              <div class="flex items-center gap-2 flex-wrap">
                <NTag
                  size="small"
                  :bordered="false"
                  :type="methodType(current.method)"
                >
                  {{ current.method.toUpperCase() }}
                </NTag>
                <span class="text-14px font-600 text-ink font-mono break-all">
                  {{ current.path }}
                </span>
                <NTag
                  v-if="current.operation.security?.length"
                  size="tiny"
                  :bordered="false"
                  type="warning"
                >
                  <template #icon
                    ><NIcon><LockClosedOutline /></NIcon
                  ></template>
                  Bearer
                </NTag>
                <NTag v-else size="tiny" :bordered="false">公开</NTag>
              </div>
              <p class="m-0 text-13px font-500 text-ink">
                {{ current.summary }}
              </p>
              <p
                v-if="current.description"
                class="m-0 text-11px text-ink-sub leading-5 whitespace-pre-line"
              >
                {{ current.description }}
              </p>
              <div class="flex items-center gap-1 flex-wrap">
                <NTag
                  v-for="tag in current.tags"
                  :key="tag"
                  size="tiny"
                  :bordered="false"
                >
                  {{ tag }}
                </NTag>
                <NButton
                  size="tiny"
                  quaternary
                  class="ml-auto"
                  @click="copy(current.path)"
                >
                  复制路径
                </NButton>
              </div>
            </div>

            <!-- 参数 -->
            <div
              v-if="queryRows(current.operation).length > 0"
              class="flex flex-col gap-1.5"
            >
              <h3 class="m-0 text-12px font-600 text-ink">参数</h3>
              <div class="overflow-x-auto">
                <table class="w-full min-w-560px border-collapse text-12px">
                  <thead>
                    <tr class="text-left text-11px text-ink-sub">
                      <th class="py-1.5 pr-3 font-500">名称</th>
                      <th class="py-1.5 px-2 font-500 w-24">位置</th>
                      <th class="py-1.5 px-2 font-500 w-16">必填</th>
                      <th class="py-1.5 px-2 font-500 w-40">类型</th>
                      <th class="py-1.5 pl-2 font-500">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in queryRows(current.operation)"
                      :key="`${row.in}-${row.name}`"
                      class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
                    >
                      <td class="py-1.5 pr-3 font-mono text-11px text-ink">
                        {{ row.name }}
                      </td>
                      <td class="py-1.5 px-2 text-ink-sub">{{ row.in }}</td>
                      <td class="py-1.5 px-2">
                        <NTag
                          v-if="row.required"
                          size="tiny"
                          :bordered="false"
                          type="warning"
                        >
                          必填
                        </NTag>
                        <span v-else class="text-11px text-ink-sub">否</span>
                      </td>
                      <td class="py-1.5 px-2 font-mono text-11px text-ink-sub">
                        {{ row.type }}
                      </td>
                      <td class="py-1.5 pl-2 text-ink-sub">
                        {{ row.description || '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <!-- 请求体 -->
            <div
              v-for="body in bodyContents(current.operation)"
              :key="body.contentType"
              class="flex flex-col gap-1.5"
            >
              <h3 class="m-0 text-12px font-600 text-ink">
                请求体
                <span class="text-11px font-400 text-ink-sub font-mono"
                  >· {{ body.contentType }}</span
                >
              </h3>
              <div v-if="body.fields.length > 0" class="overflow-x-auto">
                <table class="w-full min-w-560px border-collapse text-12px">
                  <thead>
                    <tr class="text-left text-11px text-ink-sub">
                      <th class="py-1.5 pr-3 font-500">字段</th>
                      <th class="py-1.5 px-2 font-500 w-16">必填</th>
                      <th class="py-1.5 px-2 font-500 w-44">类型</th>
                      <th class="py-1.5 pl-2 font-500">说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in body.fields"
                      :key="row.name"
                      class="border-t border-glass-border/60 dark:border-glass-border-dark/60"
                    >
                      <td class="py-1.5 pr-3 font-mono text-11px text-ink">
                        {{ row.name }}
                      </td>
                      <td class="py-1.5 px-2">
                        <NTag
                          v-if="row.required"
                          size="tiny"
                          :bordered="false"
                          type="warning"
                        >
                          必填
                        </NTag>
                        <span v-else class="text-11px text-ink-sub">否</span>
                      </td>
                      <td class="py-1.5 px-2 font-mono text-11px text-ink-sub">
                        {{ row.type }}
                      </td>
                      <td class="py-1.5 pl-2 text-ink-sub">
                        {{ row.description || '—' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <pre
                v-if="body.exampleHtml"
                class="hljs m-0 overflow-auto rounded-xl p-3 text-11px leading-5"
                v-html="body.exampleHtml"
              />
            </div>

            <!-- 响应 -->
            <div class="flex flex-col gap-2">
              <h3 class="m-0 text-12px font-600 text-ink">响应</h3>
              <div
                v-for="response in responseEntries(current.operation)"
                :key="response.status"
                class="flex flex-col gap-1.5"
              >
                <div class="flex items-center gap-2 flex-wrap">
                  <NTag
                    size="tiny"
                    :bordered="false"
                    :type="statusType(response.status)"
                  >
                    {{ response.status }}
                  </NTag>
                  <span class="text-11px text-ink-sub">{{
                    response.description || '—'
                  }}</span>
                  <span
                    v-if="response.contentType"
                    class="text-10px text-ink-sub font-mono"
                  >
                    {{ response.contentType }}
                  </span>
                </div>
                <pre
                  v-if="response.codeHtml"
                  class="hljs m-0 overflow-auto rounded-xl p-3 text-11px leading-5"
                  v-html="response.codeHtml"
                />
                <p v-else class="m-0 text-11px text-ink-sub">无示例响应体</p>
              </div>
            </div>
          </section>

          <EmptyState
            v-else
            :icon="SearchOutline"
            title="没有匹配的接口"
            description="试试清空搜索关键词，或刷新文档重新拉取。"
          >
            <NButton size="small" @click="search = ''">清空搜索</NButton>
          </EmptyState>
        </div>
      </div>
    </NSpin>
  </div>
</template>
