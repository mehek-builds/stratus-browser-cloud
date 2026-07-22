# Graph Report - .  (2026-07-22)

## Corpus Check
- 15 files · ~89,912 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 131 nodes · 190 edges · 15 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Store` - 26 edges
2. `BrowserManager` - 15 edges
3. `AgentRuntime` - 14 edges
4. `api()` - 11 edges
5. `showView()` - 7 edges
6. `loadUsage()` - 6 edges
7. `launchSession()` - 5 edges
8. `navigatePlayground()` - 5 edges
9. `stopSession()` - 5 edges
10. `FunctionRuntime` - 5 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (2): mapArtifact(), Store

### Community 1 - "Community 1"
Cohesion: 0.23
Nodes (19): api(), appendEvent(), connectEvents(), escapeHtml(), inspectSession(), launchSession(), loadAccess(), loadAgents() (+11 more)

### Community 2 - "Community 2"
Cohesion: 0.18
Nodes (4): availablePort(), boundedClose(), BrowserManager, readCdpEndpoint()

### Community 3 - "Community 3"
Cohesion: 0.23
Nodes (3): AgentRuntime, mapAgent(), mapRun()

### Community 4 - "Community 4"
Cohesion: 0.2
Nodes (0):

### Community 5 - "Community 5"
Cohesion: 0.22
Nodes (0):

### Community 6 - "Community 6"
Cohesion: 0.33
Nodes (1): FunctionRuntime

### Community 7 - "Community 7"
Cohesion: 0.4
Nodes (1): Stratus

### Community 8 - "Community 8"
Cohesion: 0.4
Nodes (0):

### Community 9 - "Community 9"
Cohesion: 0.5
Nodes (0):

### Community 10 - "Community 10"
Cohesion: 0.67
Nodes (0):

### Community 11 - "Community 11"
Cohesion: 1.0
Nodes (0):

### Community 12 - "Community 12"
Cohesion: 1.0
Nodes (0):

### Community 13 - "Community 13"
Cohesion: 1.0
Nodes (0):

### Community 14 - "Community 14"
Cohesion: 1.0
Nodes (0):

## Knowledge Gaps
- **Thin community `Community 11`** (1 nodes): `protection-policy.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 12`** (1 nodes): `store.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 13`** (1 nodes): `stratus.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 14`** (1 nodes): `config.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
