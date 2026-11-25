# LLM evaluation (`npm run eval:llm`)

Not run yet: the translator benchmark needs the real Ollama host on the LAN, which cloud build
sessions can't reach. From a checkout on any LAN machine:

```bash
npm ci
OLLAMA_URL=http://<mac-studio>:11434 npm run eval:llm -- --models gemma4:12b --runs 3
```

Add two or three candidate models (`--models a,b,c`) to compare them. The command rewrites this file
with the results and exits non-zero if no model meets every bar (PLAN §6.6).
