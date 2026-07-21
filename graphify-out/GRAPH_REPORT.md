# Graph Report - .  (2026-07-21)

## Corpus Check
- 12 files · ~61,946 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 88 nodes · 118 edges · 12 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Store` - 19 edges
2. `api()` - 9 edges
3. `BrowserManager` - 9 edges
4. `loadUsage()` - 6 edges
5. `showView()` - 5 edges
6. `launchSession()` - 5 edges
7. `navigatePlayground()` - 5 edges
8. `stopSession()` - 5 edges
9. `FunctionRuntime` - 5 edges
10. `toast()` - 4 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.16
Nodes (1): Store

### Community 1 - "Community 1"
Cohesion: 0.25
Nodes (17): api(), appendEvent(), connectEvents(), escapeHtml(), inspectSession(), launchSession(), loadContexts(), loadFunctions() (+9 more)

### Community 2 - "Community 2"
Cohesion: 0.29
Nodes (2): boundedClose(), BrowserManager

### Community 3 - "Community 3"
Cohesion: 0.22
Nodes (0): 

### Community 4 - "Community 4"
Cohesion: 0.25
Nodes (0): 

### Community 5 - "Community 5"
Cohesion: 0.33
Nodes (1): FunctionRuntime

### Community 6 - "Community 6"
Cohesion: 0.4
Nodes (0): 

### Community 7 - "Community 7"
Cohesion: 0.5
Nodes (1): Stratus

### Community 8 - "Community 8"
Cohesion: 0.67
Nodes (0): 

### Community 9 - "Community 9"
Cohesion: 1.0
Nodes (0): 

### Community 10 - "Community 10"
Cohesion: 1.0
Nodes (0): 

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 9`** (1 nodes): `store.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 10`** (1 nodes): `stratus.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 11`** (1 nodes): `config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Not enough signal to generate questions. This usually means the corpus has no AMBIGUOUS edges, no bridge nodes, no INFERRED relationships, and all communities are tightly cohesive. Add more files or run with --mode deep to extract richer edges._