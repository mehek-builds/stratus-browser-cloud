# Graph Report - .  (2026-08-20)

## Corpus Check
- 37 files · ~199,737 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 264 nodes · 332 edges · 37 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## God Nodes (most connected - your core abstractions)
1. `Store` - 26 edges
2. `BrowserManager` - 15 edges
3. `AgentRuntime` - 14 edges
4. `api()` - 11 edges
5. `executeSandboxRun()` - 9 edges
6. `showView()` - 7 edges
7. `FakeSandbox` - 6 edges
8. `loadUsage()` - 6 edges
9. `launchSession()` - 5 edges
10. `navigatePlayground()` - 5 edges

## Surprising Connections (you probably didn't know these)
- None detected - all connections are within the same source files.

## Communities

### Community 0 - "Community 0"
Cohesion: 0.12
Nodes (2): mapArtifact(), Store

### Community 1 - "Community 1"
Cohesion: 0.09
Nodes (8): choiceHelpers(), extractFunctionSource(), filledHelpers(), gateScope(), reactSelectContainer(), sandboxQuestionLabel(), sandboxScope(), showing()

### Community 2 - "Community 2"
Cohesion: 0.23
Nodes (19): api(), appendEvent(), connectEvents(), escapeHtml(), inspectSession(), launchSession(), loadAccess(), loadAgents() (+11 more)

### Community 3 - "Community 3"
Cohesion: 0.18
Nodes (4): availablePort(), boundedClose(), BrowserManager, readCdpEndpoint()

### Community 4 - "Community 4"
Cohesion: 0.23
Nodes (3): AgentRuntime, mapAgent(), mapRun()

### Community 5 - "Community 5"
Cohesion: 0.13
Nodes (0): 

### Community 6 - "Community 6"
Cohesion: 0.31
Nodes (12): continuationEligible(), continuationSandboxName(), digest(), ensureSandboxTemplate(), executeSandboxRun(), inputError(), normalizeManagedActions(), normalizeManagedContinuation() (+4 more)

### Community 7 - "Community 7"
Cohesion: 0.29
Nodes (4): readResult(), resultPath(), run(), writeInput()

### Community 8 - "Community 8"
Cohesion: 0.2
Nodes (0): 

### Community 9 - "Community 9"
Cohesion: 0.22
Nodes (0): 

### Community 10 - "Community 10"
Cohesion: 0.47
Nodes (4): evaluateSnapshot(), read(), readVisible(), visibleValues()

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (1): FakeSandbox

### Community 12 - "Community 12"
Cohesion: 0.33
Nodes (0): 

### Community 13 - "Community 13"
Cohesion: 0.33
Nodes (0): 

### Community 14 - "Community 14"
Cohesion: 0.33
Nodes (0): 

### Community 15 - "Community 15"
Cohesion: 0.33
Nodes (1): FunctionRuntime

### Community 16 - "Community 16"
Cohesion: 0.6
Nodes (3): balancedFrom(), extractEvaluateCallback(), extractVerdict()

### Community 17 - "Community 17"
Cohesion: 0.4
Nodes (1): Stratus

### Community 18 - "Community 18"
Cohesion: 0.4
Nodes (0): 

### Community 19 - "Community 19"
Cohesion: 0.5
Nodes (0): 

### Community 20 - "Community 20"
Cohesion: 0.67
Nodes (2): build(), protectedAttempt()

### Community 21 - "Community 21"
Cohesion: 0.5
Nodes (0): 

### Community 22 - "Community 22"
Cohesion: 0.67
Nodes (2): loadConfiguration(), setMessage()

### Community 23 - "Community 23"
Cohesion: 0.5
Nodes (0): 

### Community 24 - "Community 24"
Cohesion: 0.67
Nodes (0): 

### Community 25 - "Community 25"
Cohesion: 0.67
Nodes (0): 

### Community 26 - "Community 26"
Cohesion: 0.67
Nodes (0): 

### Community 27 - "Community 27"
Cohesion: 1.0
Nodes (0): 

### Community 28 - "Community 28"
Cohesion: 1.0
Nodes (0): 

### Community 29 - "Community 29"
Cohesion: 1.0
Nodes (0): 

### Community 30 - "Community 30"
Cohesion: 1.0
Nodes (0): 

### Community 31 - "Community 31"
Cohesion: 1.0
Nodes (0): 

### Community 32 - "Community 32"
Cohesion: 1.0
Nodes (0): 

### Community 33 - "Community 33"
Cohesion: 1.0
Nodes (0): 

### Community 34 - "Community 34"
Cohesion: 1.0
Nodes (0): 

### Community 35 - "Community 35"
Cohesion: 1.0
Nodes (0): 

### Community 36 - "Community 36"
Cohesion: 1.0
Nodes (0): 

## Knowledge Gaps
- **Thin community `Community 27`** (2 nodes): `http-auth.test.js`, `responseRecorder()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 28`** (2 nodes): `health.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 29`** (2 nodes): `run.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 30`** (2 nodes): `config.js`, `handler()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 31`** (1 nodes): `date-component-option.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (1 nodes): `sole-option-consent.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 33`** (1 nodes): `protection-policy.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 34`** (1 nodes): `store.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 35`** (1 nodes): `graded-band-option.test.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 36`** (1 nodes): `stratus.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `FakeSandbox` connect `Community 11` to `Community 1`?**
  _High betweenness centrality (0.004) - this node is a cross-community bridge._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.12 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.09 - nodes in this community are weakly interconnected._
- **Should `Community 5` be split into smaller, more focused modules?**
  _Cohesion score 0.13 - nodes in this community are weakly interconnected._