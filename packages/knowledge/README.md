# @apogee/knowledge

Retrieval for an assistant: markdown becomes chunks with stable ids and
content hashes, a chunk store ranks them for a query within a visibility
scope, and a prompt contributor injects the matching excerpts with
citations. Lexical (BM25) and vector stores ship in memory; embeddings are
a host-supplied port. Spec: `docs/design/ai-abstractions.md` §3.8.

## Surface

| Concept | Import | One-liner |
|---|---|---|
| Chunk | `chunkMarkdown(source, markdown, { scope, section, maxWords })`, `Chunk` | h1–h3 split, then paragraph split over 500 words; id `source#slug[#part]`, sha256 hash, host-defined `scope` |
| Store | `ChunkStore`, `createLexicalChunkStore()`, `reingest(store, source, chunks)` | `upsert` by id with hash change detection, `search(query, { scope, section, limit })`, `remove`, `list`, `stats`; reingest deletes orphans |
| Vector | `EmbeddingPort`, `createVectorChunkStore({ embedder })`, `createHybridChunkStore({ lexical, vector })`, `createHashEmbedder()` | Cosine ranking over host embeddings; reciprocal rank fusion; a deterministic test embedder |
| Retrieve | `retrieve(store, query)`, `formatRetrieval(chunks)` → `Retrieval { text, chunks, citations }` | Numbered excerpts (`### Title [n]`, `_Source: …_`) under a heading, bounded by a character budget |
| Contributor | `knowledgeContributor({ store, queryFromCtx, scopeFromCtx })`, `isHelpQuery` | Fills a prompt slot from the context's question, only when it looks like a question and something matched |
| Answer | `answer(store, question, { client, domain })` | Retrieve, then ask the model to answer from the excerpts citing `[n]` |
| Prompts | `knowledgePromptRegistry()`, `ANSWER_PROMPT` | The one registered prompt |

## Guarantees

- Chunk ids are stable across reingests as long as the source path and heading are; content changes are detected by hash, and removed headings are removed from the store.
- Every search honors `scope`; a chunk is never returned to a scope it was not ingested under.
- Excerpts always carry a numbered citation and the source path, so an answer can point back.
- No help topics, section names, or scope names ship in the package.

## Example

```ts
const store = createLexicalChunkStore();
for (const file of policyFiles) await reingest(store, file.path, chunkMarkdown(file.path, file.markdown, { scope: 'user' }));

// In an agent prompt: definePrompt({ sections: [..., slot('knowledge', 'knowledge')] })
const contributors = { knowledge: knowledgeContributor({ store, queryFromCtx: (c) => c.lastQuestion, scope: 'user', limit: 3 }) };

// Or a direct answer with citations
const { text, retrieval } = await answer(store, 'How do refunds work?', { client, domain: 'an equipment rental company' });
```
